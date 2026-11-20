import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { render } from "./templates";
import { EmailError, getProvider } from "./providers";

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/**
 * Drains the email outbox through the configured provider (Brevo or Resend).
 * Rows were persisted by the business transaction first, so a provider outage never loses a
 * lead/task/payroll record — it just retries with backoff. Each row is claimed once
 * (FOR UPDATE SKIP LOCKED), which is what prevents duplicate sends; Brevo has no idempotency key.
 */
export async function drainOutbox(limit = 20) {
  const from = process.env.EMAIL_FROM;
  const provider = await getProvider();
  if (!provider || !from) return { configured: false, provider: provider?.name ?? null, processed: 0 };

  const sb = supabaseAdmin();
  const { data: jobs, error } = await sb.rpc("claim_email_batch", { p_limit: limit });
  if (error) throw new Error(`claim failed: ${error.message}`);

  let sent = 0, failed = 0;
  for (const job of jobs ?? []) {
    const content = render(job.template, job.payload ?? {});
    if (!content) {
      await sb.from("email_outbox").update({ status: "SKIPPED", last_error: `unknown template ${job.template}` }).eq("id", job.id);
      continue;
    }
    try {
      const r = await provider.send({ from, to: job.to_email, subject: content.subject, html: content.html, text: content.text,
        replyTo: process.env.EMAIL_REPLY_TO || undefined, tags: [job.template.split(".")[0]!], refId: job.id });
      await sb.from("email_outbox").update({ status: "SENT", sent_at: new Date().toISOString(), provider_message_id: r.messageId, last_error: null }).eq("id", job.id);
      sent++;
    } catch (e) {
      const err = e instanceof EmailError ? e : new EmailError((e as Error).message, false);
      const delay = BACKOFF_MIN[Math.min(job.attempts - 1, BACKOFF_MIN.length - 1)]!;
      await sb.from("email_outbox").update({
        status: err.permanent || job.attempts >= job.max_attempts ? "FAILED" : "QUEUED",
        last_error: `[${provider.name}] ${err.message}`.slice(0, 500),
        next_attempt_at: err.permanent ? "infinity" : new Date(Date.now() + delay * 60_000).toISOString(),
      }).eq("id", job.id);
      failed++;
    }
  }
  return { configured: true, provider: provider.name, processed: (jobs ?? []).length, sent, failed };
}
