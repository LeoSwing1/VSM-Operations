"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
import { sendDirect } from "@/lib/delivery/worker";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/delivery/ssrf";

const CH = "/settings/integrations/channels";
const WH = "/settings/integrations/webhooks";
import { ORG_EVENTS } from "@/lib/delivery/events";

async function record(key: string, ok: boolean, ms: number, message: string, back: string): Promise<never> {
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  await Promise.all([
    sb.from("integration_check_runs").insert({
      org_id: ctx.org_id,
      integration_key: key,
      status: ok ? "HEALTHY" : "FAILED",
      latency_ms: ms,
      message: message.slice(0, 500),
      details: {},
      checked_by: ctx.employee_id,
    }),
    sb.rpc("record_integration_test", { p_key: key, p_ok: ok, p_error: ok ? null : message.slice(0, 500) }),
  ]);
  flash(back, ok ? "ok" : "err", `${key.replace("_", " ").toUpperCase()} test ${ok ? "passed" : "failed"}: ${message} (${ms} ms).`);
}

const testPayload = (name: string) => ({
  title: "VSM Ops test message",
  body: `Sent by ${name} from the Integration Control Centre. If you can read this, the channel works.`,
  link: "/settings/integrations/channels",
});

export async function testWhatsApp() {
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const { data: wa } = await sb.from("whatsapp_optins").select("phone_e164, opted_in").eq("employee_id", ctx.employee_id).maybeSingle();
  if (!wa?.opted_in) flash(CH, "err", "Opt in your own number first (Notifications → Preferences). Tests only go to your own phone.");
  const r = await sendDirect("WHATSAPP", ctx.org_id, { ...testPayload(ctx.full_name), to: wa.phone_e164 });
  await record("whatsapp", r.ok, r.ms, r.message, CH);
}

export async function testPush() {
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const { data: subs } = await sb.from("push_subscriptions").select("id").eq("employee_id", ctx.employee_id).is("revoked_at", null);
  if (!subs?.length) flash(CH, "err", "Turn on push for this device first (Notifications → Preferences).");
  const results = await Promise.all(subs.map((s) => sendDirect("PUSH", ctx.org_id, testPayload(ctx.full_name), s.id)));
  const ok = results.filter((r) => r.ok).length;
  await record(
    "push",
    ok > 0,
    Math.max(...results.map((r) => r.ms)),
    `${ok}/${results.length} of your devices accepted the push${ok < results.length ? ` — ${results.find((r) => !r.ok)?.message}` : ""}`,
    CH,
  );
}

export async function testTeamChannel(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const key = str(fd, "key") === "teams" ? "teams" : "slack";
  const r = await sendDirect(
    key === "slack" ? "SLACK" : "TEAMS",
    ctx.org_id,
    { title: "VSM Ops test", summary: `Connection test by ${ctx.full_name}`, link: "/settings/integrations/channels" },
    null,
    "integration.test",
  );
  await record(key, r.ok, r.ms, r.message, CH);
}

export async function saveTeamChannel(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const key = str(fd, "key") === "teams" ? "teams" : "slack";
  const events = ORG_EVENTS.filter((e) => fd.get(`ev:${e}`) === "on");
  if (!events.length) flash(CH, "err", "Pick at least one event.");
  const sb = await supabaseServer();
  const { error } = await sb.from("integration_settings").upsert({
    org_id: ctx.org_id,
    key,
    enabled: fd.get("enabled") === "on",
    events,
    updated_by: ctx.employee_id,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(CH, "err", dbMessage(error));
  flash(CH, "ok", `${key === "slack" ? "Slack" : "Teams"} routing saved.`);
}

export async function retryChannel(fd: FormData) {
  await requirePerm("settings.manage");
  const ch = str(fd, "channel");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("retry_failed_deliveries", {
    p_channel: ["WHATSAPP", "PUSH", "SLACK", "TEAMS", "WEBHOOK"].includes(ch) ? ch : null,
  });
  if (error) flash(CH, "err", dbMessage(error));
  flash(CH, "ok", `${data ?? 0} failed deliveries queued again. The delivery worker sends them on its next run.`);
}

// ---------- Outbound webhooks ----------
export type SecretState = { ok: boolean; message: string; secret?: string; name?: string };

const NewHook = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  url: z
    .string()
    .trim()
    .url("Enter a full https:// URL")
    .max(500)
    .refine((u) => u.startsWith("https://"), "Only https:// endpoints are allowed"),
});

export async function createWebhook(_prev: SecretState | null, fd: FormData): Promise<SecretState> {
  const ctx = await requirePerm("settings.manage");
  const p = NewHook.safeParse({ name: fd.get("name"), url: fd.get("url") });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Invalid input" };
  const events = ORG_EVENTS.filter((e) => fd.get(`ev:${e}`) === "on");
  if (!events.length) return { ok: false, message: "Pick at least one event." };
  try {
    await assertSafeUrl(p.data.url);
  } catch (e) {
    return { ok: false, message: e instanceof UnsafeUrlError ? `Blocked destination: ${e.message}` : "Couldn't resolve that host." };
  }
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const sb = await supabaseServer();
  const { error } = await sb
    .from("webhook_endpoints")
    .insert({ org_id: ctx.org_id, name: p.data.name, url: p.data.url, secret, events, created_by: ctx.employee_id })
    .select("id")
    .single();
  if (error) return { ok: false, message: dbMessage(error) };
  revalidatePath(WH);
  return { ok: true, message: "Endpoint created.", secret, name: p.data.name };
}

export async function rotateWebhookSecret(_prev: SecretState | null, fd: FormData): Promise<SecretState> {
  await requirePerm("settings.manage");
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const sb = await supabaseServer();
  const { data, error } = await sb.from("webhook_endpoints").update({ secret }).eq("id", str(fd, "id")).select("name").single();
  if (error) return { ok: false, message: dbMessage(error) };
  revalidatePath(WH);
  return {
    ok: true,
    message: "Secret rotated — update your receiver now. The old secret stops working immediately.",
    secret,
    name: data.name,
  };
}

export async function toggleWebhook(fd: FormData) {
  await requirePerm("settings.manage");
  const enable = str(fd, "enable") === "1";
  const sb = await supabaseServer();
  const { error } = await sb
    .from("webhook_endpoints")
    .update(
      enable
        ? { enabled: true, consecutive_failures: 0, disabled_reason: null }
        : { enabled: false, disabled_reason: "Disabled by an admin" },
    )
    .eq("id", str(fd, "id"));
  if (error) flash(WH, "err", dbMessage(error));
  flash(WH, "ok", enable ? "Endpoint enabled." : "Endpoint disabled.");
}

export async function deleteWebhook(fd: FormData) {
  await requirePerm("settings.manage");
  if (str(fd, "confirm") !== "DELETE") flash(WH, "err", "Type DELETE to confirm.");
  const sb = await supabaseServer();
  const { error } = await sb.from("webhook_endpoints").delete().eq("id", str(fd, "id"));
  if (error) flash(WH, "err", dbMessage(error));
  flash(WH, "ok", "Endpoint deleted.");
}

export async function pingWebhook(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const r = await sendDirect("WEBHOOK", ctx.org_id, { message: "ping", sent_by: ctx.full_name }, str(fd, "id"), "integration.test");
  await record("webhooks", r.ok, r.ms, r.message, WH);
}
