import "server-only";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertSafeUrl, UnsafeUrlError } from "./ssrf";
import { signWebhook } from "./signatures";
import { pushPayload, slackMessage, teamsMessage, whatsappTemplate, type Payload } from "./messages";

const BACKOFF_MIN = [1, 5, 15, 60, 240];
const DISABLE_AFTER = 20; // consecutive webhook failures before an endpoint is switched off

export class DeliveryError extends Error {
  constructor(
    message: string,
    public permanent: boolean,
    public revokeTarget = false,
  ) {
    super(message);
  }
}

interface Job {
  id: string;
  org_id: string;
  channel: "WHATSAPP" | "PUSH" | "SLACK" | "TEAMS" | "WEBHOOK";
  recipient_employee_id: string | null;
  target_ref: string | null;
  event_key: string;
  payload: Payload;
  attempts: number;
  max_attempts: number;
}

/** Which channels are configured right now (env), used by the panel and the worker. */
export function channelConfig(env = process.env) {
  return {
    whatsapp: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
    push: !!(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    slack: !!env.SLACK_WEBHOOK_URL,
    teams: !!env.TEAMS_WEBHOOK_URL,
    webhooks: true,
    meta_leads: !!(env.META_APP_SECRET && env.META_VERIFY_TOKEN && env.META_PAGE_TOKEN),
    razorpay: !!env.RAZORPAY_WEBHOOK_SECRET,
    analytics: !!env.NEXT_PUBLIC_POSTHOG_KEY,
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 8000) {
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", "user-agent": "VSM-Ops/1.0", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (res.status >= 300 && res.status < 400)
    throw new DeliveryError(`Destination redirected (${res.status}); redirects are not followed`, true);
  return res;
}

function classify(status: number, detail: string, label: string): never {
  const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  throw new DeliveryError(`${label} ${status}: ${detail.slice(0, 200)}`, permanent);
}

async function sendWhatsApp(job: Job): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN,
    phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new DeliveryError("WhatsApp is not configured", false);
  const to = String(job.payload.to ?? "");
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new DeliveryError("Recipient has no valid WhatsApp number", true);
  const res = await postJson(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`,
    whatsappTemplate(to, job.payload),
    {
      authorization: `Bearer ${token}`,
    },
  );
  const text = await res.text();
  if (!res.ok) classify(res.status, text, "WhatsApp");
  try {
    return (JSON.parse(text) as { messages?: { id: string }[] }).messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function sendPush(job: Job, sb: ReturnType<typeof supabaseAdmin>): Promise<string | null> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new DeliveryError("Web push is not configured", false);
  const { data: sub } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_secret, revoked_at")
    .eq("id", job.target_ref ?? "")
    .maybeSingle();
  if (!sub || sub.revoked_at) throw new DeliveryError("Subscription no longer exists", true);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? `mailto:${process.env.EMAIL_REPLY_TO ?? "ops@vsmgrowth.com"}`, pub, priv);
  try {
    const r = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
      pushPayload(job.payload),
      { TTL: 3600, timeout: 8000 },
    );
    await sb.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", sub.id);
    return r.headers?.location ?? null;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    if (status === 404 || status === 410) {
      await sb.from("push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", sub.id);
      throw new DeliveryError(`Browser subscription expired (${status}) — removed`, true, true);
    }
    throw new DeliveryError(
      `Push ${status || "error"}: ${(e as Error).message.slice(0, 200)}`,
      status >= 400 && status < 500 && status !== 429,
    );
  }
}

async function sendTeamMessaging(job: Job): Promise<null> {
  const url = job.channel === "SLACK" ? process.env.SLACK_WEBHOOK_URL : process.env.TEAMS_WEBHOOK_URL;
  if (!url) throw new DeliveryError(`${job.channel === "SLACK" ? "Slack" : "Teams"} is not configured`, false);
  await assertSafeUrl(url);
  const body = job.channel === "SLACK" ? slackMessage(job.event_key, job.payload) : teamsMessage(job.event_key, job.payload);
  const res = await postJson(url, body);
  if (!res.ok) classify(res.status, await res.text().catch(() => ""), job.channel === "SLACK" ? "Slack" : "Teams");
  return null;
}

async function sendWebhook(job: Job, sb: ReturnType<typeof supabaseAdmin>): Promise<null> {
  const { data: ep } = await sb
    .from("webhook_endpoints")
    .select("id, url, secret, enabled, consecutive_failures")
    .eq("id", job.target_ref ?? "")
    .maybeSingle();
  if (!ep || !ep.enabled) throw new DeliveryError("Webhook endpoint is disabled or deleted", true);
  try {
    await assertSafeUrl(ep.url);
  } catch (e) {
    throw new DeliveryError(e instanceof UnsafeUrlError ? `Blocked destination: ${e.message}` : "URL check failed", true);
  }
  const body = JSON.stringify({ id: job.id, event: job.event_key, created_at: new Date().toISOString(), data: job.payload });
  const res = await postJson(
    ep.url,
    body,
    { "x-vsm-event": job.event_key, "x-vsm-delivery": job.id, "x-vsm-signature": signWebhook(ep.secret, body) },
    10_000,
  );
  if (!res.ok) classify(res.status, await res.text().catch(() => ""), "Webhook");
  return null;
}

/** Drains due deliveries for every channel. Event rows were committed by the business transaction first. */
export async function drainDeliveries(limit = 50) {
  const sb = supabaseAdmin();
  const { data: jobs, error } = await sb.rpc("claim_delivery_batch", { p_limit: limit });
  if (error) throw new Error(`delivery claim failed: ${error.message}`);
  const outcome = new Map<string, { ok: number; err: string | null }>(); // `${org}|${key}`
  let sent = 0,
    failed = 0;

  for (const job of (jobs ?? []) as Job[]) {
    const key = job.channel === "WEBHOOK" ? "webhooks" : job.channel.toLowerCase();
    const bucket = `${job.org_id}|${key}`;
    if (!outcome.has(bucket)) outcome.set(bucket, { ok: 0, err: null });
    try {
      const providerId =
        job.channel === "WHATSAPP"
          ? await sendWhatsApp(job)
          : job.channel === "PUSH"
            ? await sendPush(job, sb)
            : job.channel === "WEBHOOK"
              ? await sendWebhook(job, sb)
              : await sendTeamMessaging(job);
      await sb
        .from("delivery_outbox")
        .update({ status: "SENT", sent_at: new Date().toISOString(), provider_message_id: providerId, last_error: null })
        .eq("id", job.id);
      if (job.channel === "WEBHOOK" && job.target_ref)
        await sb
          .from("webhook_endpoints")
          .update({ consecutive_failures: 0, last_success_at: new Date().toISOString() })
          .eq("id", job.target_ref);
      outcome.get(bucket)!.ok++;
      sent++;
    } catch (e) {
      const err = e instanceof DeliveryError ? e : new DeliveryError((e as Error).message, false);
      const delay = BACKOFF_MIN[Math.min(job.attempts - 1, BACKOFF_MIN.length - 1)]!;
      const final = err.permanent || job.attempts >= job.max_attempts;
      await sb
        .from("delivery_outbox")
        .update({
          status: err.revokeTarget ? "SKIPPED" : final ? "FAILED" : "QUEUED",
          last_error: err.message.slice(0, 500),
          next_attempt_at: final ? "infinity" : new Date(Date.now() + delay * 60_000).toISOString(),
        })
        .eq("id", job.id);
      if (job.channel === "WEBHOOK" && job.target_ref && final) {
        const { data: ep } = await sb.from("webhook_endpoints").select("consecutive_failures").eq("id", job.target_ref).maybeSingle();
        const n = (ep?.consecutive_failures ?? 0) + 1;
        await sb
          .from("webhook_endpoints")
          .update({
            consecutive_failures: n,
            last_failure_at: new Date().toISOString(),
            ...(n >= DISABLE_AFTER
              ? { enabled: false, disabled_reason: `Disabled after ${n} failed deliveries in a row: ${err.message.slice(0, 160)}` }
              : {}),
          })
          .eq("id", job.target_ref);
      }
      if (!err.revokeTarget) outcome.get(bucket)!.err = err.message;
      failed++;
    }
  }
  for (const [bucket, r] of outcome) {
    const [org, key] = bucket.split("|") as [string, string];
    await sb.rpc("record_integration_event", { p_org: org, p_key: key, p_ok: !r.err, p_error: r.err });
  }
  return { processed: (jobs ?? []).length, sent, failed };
}

/**
 * Sends one message immediately (admin "test" buttons). Not queued, never retried.
 * Only the caller decides the target; the payload must not contain amounts.
 */
export async function sendDirect(
  channel: Job["channel"],
  orgId: string,
  payload: Payload,
  targetRef: string | null = null,
  eventKey = "integration.test",
): Promise<{ ok: boolean; message: string; ms: number }> {
  const started = Date.now();
  const job: Job = {
    id: crypto.randomUUID(),
    org_id: orgId,
    channel,
    recipient_employee_id: null,
    target_ref: targetRef,
    event_key: eventKey,
    payload,
    attempts: 0,
    max_attempts: 1,
  };
  const sb = supabaseAdmin();
  try {
    const ref =
      channel === "WHATSAPP"
        ? await sendWhatsApp(job)
        : channel === "PUSH"
          ? await sendPush(job, sb)
          : channel === "WEBHOOK"
            ? await sendWebhook(job, sb)
            : await sendTeamMessaging(job);
    return { ok: true, message: ref ? `Delivered (provider id ${String(ref).slice(0, 60)})` : "Delivered", ms: Date.now() - started };
  } catch (e) {
    return { ok: false, message: (e as Error).message.slice(0, 300), ms: Date.now() - started };
  }
}
