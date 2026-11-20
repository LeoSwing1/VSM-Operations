"use server";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash } from "@/lib/actions";
import { getProvider, EmailError } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";

const BACK = "/settings/integrations";

/** Sends a real email straight through the provider (not the outbox) and records the true result. */
export async function testEmail() {
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const provider = await getProvider();
  const from = process.env.EMAIL_FROM;
  if (!provider || !from) {
    await sb.rpc("record_integration_test", { p_key: "email", p_ok: false, p_error: "Not configured: set EMAIL_PROVIDER, BREVO_API_KEY (or RESEND_API_KEY) and EMAIL_FROM" });
    flash(BACK, "err", "Email isn't configured yet. Add the Brevo key and EMAIL_FROM in Vercel, redeploy, then test again.");
  }
  const at = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.timezone }).format(new Date());
  const c = render("integration.test", { by: ctx.full_name, at, provider: provider.name })!;
  let ok = true, err: string | null = null;
  try {
    await provider.send({ from, to: ctx.email, subject: c.subject, html: c.html, text: c.text, refId: `test-${Date.now()}`, tags: ["integration"] });
  } catch (e) { ok = false; err = e instanceof EmailError ? e.message : (e as Error).message; }
  const { error } = await sb.rpc("record_integration_test", { p_key: "email", p_ok: ok, p_error: err });
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, ok ? "ok" : "err", ok ? `Test email sent to ${ctx.email} via ${provider.name}. Check your inbox (and spam).` : `Email test failed: ${err}`);
}

export async function testDatabase() {
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const started = Date.now();
  const { error } = await sb.from("organizations").select("id").limit(1);
  const ms = Date.now() - started;
  await sb.rpc("record_integration_test", { p_key: "database", p_ok: !error, p_error: error?.message ?? null });
  flash(BACK, error ? "err" : "ok", error ? `Database check failed: ${error.message}` : `Database reachable — round trip ${ms} ms.`);
}

export async function retryFailed() {
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("retry_failed_emails");
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", `${data ?? 0} failed email(s) queued again. They go out on the next cron run.`);
}
