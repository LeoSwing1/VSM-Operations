import "server-only";
/**
 * Email providers. Choose with EMAIL_PROVIDER=brevo | resend | gmail (default: brevo if BREVO_API_KEY is set, else resend).
 * Both receive the same message; the outbox worker owns retries, dedupe and status.
 */
export interface OutgoingEmail {
  from: string; // "VSM Growth <ops@mail.vsmgrowth.com>"
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: string[];
  refId: string; // outbox row id — used for idempotency/tracing
}
export interface SendResult {
  messageId: string | null;
}
export class EmailError extends Error {
  constructor(
    message: string,
    public permanent: boolean,
    public status?: number,
  ) {
    super(message);
    this.name = "EmailError";
  }
}
export interface EmailProvider {
  name: "brevo" | "resend" | "gmail";
  send(m: OutgoingEmail): Promise<SendResult>;
}

/** "Name <a@b.com>" | "a@b.com" → { name, email } */
export function parseAddress(raw: string): { name?: string; email: string } {
  const m = raw.trim().match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (m) return { name: m[1]!.trim() || undefined, email: m[2]! };
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw.trim())) return { email: raw.trim() };
  throw new EmailError(`Invalid address "${raw}"`, true);
}

/** Exported for tests: the exact JSON Brevo receives. */
export function brevoPayload(m: OutgoingEmail) {
  const sender = parseAddress(m.from);
  return {
    sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
    to: [{ email: parseAddress(m.to).email }],
    subject: m.subject,
    htmlContent: m.html,
    textContent: m.text,
    ...(m.replyTo ? { replyTo: { email: parseAddress(m.replyTo).email } } : {}),
    headers: { "X-Entity-Ref-Id": m.refId },
    tags: (m.tags ?? []).slice(0, 10),
  };
}

export function brevoProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: "brevo",
    async send(m) {
      let res: Response;
      try {
        res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(brevoPayload(m)),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        throw new EmailError(`Brevo network error: ${(e as Error).message}`, false);
      }
      if (res.status === 201 || res.status === 200) {
        const body = (await res.json().catch(() => ({}))) as { messageId?: string; messageIds?: string[] };
        return { messageId: body.messageId ?? body.messageIds?.[0] ?? null };
      }
      const detail = await res.text().catch(() => "");
      // 400/401/403 won't fix themselves (bad payload, bad key, unverified sender). 429/5xx are retried.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new EmailError(`Brevo ${res.status}: ${detail.slice(0, 300)}`, permanent, res.status);
    },
  };
}

export async function resendProvider(apiKey: string): Promise<EmailProvider> {
  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(m) {
      const r = await client.emails.send(
        {
          from: m.from,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          replyTo: m.replyTo,
          headers: { "X-Entity-Ref-ID": m.refId },
        },
        { idempotencyKey: `outbox-${m.refId}` },
      );
      if (r.error) {
        const permanent = /validation|invalid|not.?allowed|restricted|missing/i.test(r.error.name + r.error.message);
        throw new EmailError(`Resend: ${r.error.message}`, permanent);
      }
      return { messageId: r.data?.id ?? null };
    },
  };
}

/** Picks the configured provider, or null when email isn't configured (jobs stay queued). */
export async function getProvider(env = process.env): Promise<EmailProvider | null> {
  const choice = (env.EMAIL_PROVIDER ?? (env.BREVO_API_KEY ? "brevo" : "resend")).toLowerCase();
  if (choice === "brevo") return env.BREVO_API_KEY ? brevoProvider(env.BREVO_API_KEY) : null;
  if (choice === "resend") return env.RESEND_API_KEY ? resendProvider(env.RESEND_API_KEY) : null;
  if (choice === "gmail") {
    // Google Workspace: send through the connected company Gmail account (Settings → Integrations → Google).
    const { gmailSenderConnection, sendViaGmail } = await import("@/lib/google/gmail");
    if (!(await gmailSenderConnection())) return null;
    return {
      name: "gmail",
      async send(m) {
        try {
          return await sendViaGmail(m);
        } catch (e) {
          const msg = (e as Error).message;
          throw new EmailError(msg, /\b(400|403)\b/.test(msg));
        }
      },
    };
  }
  return null;
}
