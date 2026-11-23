"use server";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { dbMessage, flash } from "@/lib/actions";
import { getProvider, EmailError } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";

const BACK = "/settings/integrations";
type CheckKey =
  | "storage"
  | "auth"
  | "realtime"
  | "email"
  | "database"
  | "whatsapp"
  | "push"
  | "slack"
  | "teams"
  | "webhooks"
  | "meta_leads"
  | "razorpay"
  | "analytics";
/** Records the check (history + status) and redirects back with the result. Never returns. */
async function saveCheck(
  key: CheckKey,
  ok: boolean,
  latency: number,
  message: string,
  details: Record<string, unknown> = {},
): Promise<never> {
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const status = ok ? "HEALTHY" : "FAILED";
  const [{ error: historyError }, { error: statusError }] = await Promise.all([
    sb.from("integration_check_runs").insert({
      org_id: ctx.org_id,
      integration_key: key,
      status,
      latency_ms: latency,
      message: message.slice(0, 500),
      details,
      checked_by: ctx.employee_id,
    }),
    sb.rpc("record_integration_test", { p_key: key, p_ok: ok, p_error: ok ? null : message.slice(0, 500) }),
  ]);
  if (historyError) flash(BACK, "err", `Check ran, but its history could not be saved: ${dbMessage(historyError)}`);
  if (statusError) flash(BACK, "err", `Check ran, but status could not be saved: ${dbMessage(statusError)}`);
  flash(BACK, ok ? "ok" : "err", `${key.toUpperCase()} ${ok ? "check passed" : "check failed"}: ${message} (${latency} ms).`);
}

/** Probes actual private buckets using the service role, without exposing object contents. */
export async function testStorage() {
  await requirePerm("settings.manage");
  const started = Date.now();
  let ok = false,
    message = "",
    details: Record<string, unknown> = {};
  try {
    const { data, error } = await supabaseAdmin().storage.listBuckets();
    if (error) throw error;
    const names = new Set((data ?? []).map((b) => b.name));
    const required = ["employee-private", "finance-receipts", "chat-files", "quality-evidence"];
    const missing = required.filter((n) => !names.has(n));
    ok = missing.length === 0;
    message = missing.length
      ? `Storage reachable; missing required buckets: ${missing.join(", ")}`
      : `Storage reachable; ${required.length} required private buckets found.`;
    details = { requiredBuckets: required, missingBuckets: missing };
  } catch (e) {
    message = `Storage check failed: ${(e as Error).message}`;
  }
  await saveCheck("storage", ok, Date.now() - started, message, details);
}

/** Verifies the service-role Auth Admin API is reachable; no user records are returned to the UI. */
export async function testAuthAdmin() {
  await requirePerm("settings.manage");
  const started = Date.now();
  let ok = false,
    message = "",
    details: Record<string, unknown> = {};
  try {
    const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    ok = true;
    message = "Supabase Auth Admin API reachable.";
    details = { api: "admin.listUsers", sampleCount: data.users.length };
  } catch (e) {
    message = `Auth Admin API check failed: ${(e as Error).message}`;
  }
  await saveCheck("auth", ok, Date.now() - started, message, details);
}

/** Performs a short-lived Realtime channel handshake and always removes the temporary channel. */
/**
 * Realtime check AS THE SIGNED-IN ADMIN (anon key + their own access token), joining a PRIVATE
 * chat channel they belong to. This is exactly what employees' browsers do, so a green result
 * means real users can receive live chat — not just that the service is up.
 */
export async function testRealtime() {
  const ctx = await requirePerm("settings.manage");
  const started = Date.now();
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.access_token) return saveCheck("realtime", false, 0, "No user session to test with — sign in again.");
  const { data: membership } = await sb
    .from("chat_channel_members")
    .select("channel_id")
    .eq("employee_id", ctx.employee_id)
    .limit(1)
    .maybeSingle();
  const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await user.realtime.setAuth(session.access_token);
  const topic = membership ? `chat:${membership.channel_id}` : `vsm-health:${ctx.org_id}`;
  const channel = user.channel(topic, { config: { private: !!membership } });
  let result = "CHANNEL_ERROR";
  try {
    result = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve("TIMED_OUT"), 8000);
      channel.subscribe((state) => {
        if (state === "SUBSCRIBED" || state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          clearTimeout(timeout);
          resolve(state);
        }
      });
    });
  } catch {
    result = "CHANNEL_ERROR";
  } finally {
    await user.removeChannel(channel).catch(() => undefined);
  }
  const ok = result === "SUBSCRIBED";
  const scope = membership ? "a private chat channel you belong to" : "a public channel (join a chat to test private channels)";
  return saveCheck(
    "realtime",
    ok,
    Date.now() - started,
    ok
      ? `Live updates work for signed-in users: joined ${scope}.`
      : `Signed-in users can't receive live updates (${result}) on ${scope}. Check Realtime is enabled and migration 0019 policies are applied.`,
    { state: result, private: !!membership },
  );
}

/** Sends a real email straight through the provider (not the outbox) and records the true result. */
export async function testEmail() {
  const ctx = await requirePerm("settings.manage");
  const provider = await getProvider();
  const from = process.env.EMAIL_FROM;
  if (!provider || !from) {
    return saveCheck("email", false, 0, "Email is not configured: provider API key or EMAIL_FROM is missing.");
  }
  const at = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.timezone }).format(new Date());
  const c = render("integration.test", { by: ctx.full_name, at, provider: provider.name })!;
  let ok = true,
    err: string | null = null;
  try {
    await provider.send({
      from,
      to: ctx.email,
      subject: c.subject,
      html: c.html,
      text: c.text,
      refId: `test-${Date.now()}`,
      tags: ["integration"],
    });
  } catch (e) {
    ok = false;
    err = e instanceof EmailError ? e.message : (e as Error).message;
  }
  await saveCheck(
    "email",
    ok,
    0,
    ok ? `Test email accepted by ${provider.name} for ${ctx.email}.` : `Email test failed: ${err ?? "provider error"}`,
    { provider: provider.name },
  );
}

export async function testDatabase() {
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const started = Date.now();
  const { error } = await sb.from("organizations").select("id").limit(1);
  const ms = Date.now() - started;
  await saveCheck(
    "database",
    !error,
    ms,
    error ? `Database check failed: ${error.message}` : "Authenticated database round-trip succeeded.",
    { query: "organizations.select(id).limit(1)" },
  );
}

export async function retryFailed() {
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("retry_failed_emails");
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", `${data ?? 0} failed email(s) queued again. They go out on the next cron run.`);
}
