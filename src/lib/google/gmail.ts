import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { googleConnectionFor, googleFetch, hasScope } from "./oauth";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** RFC 5322 message with text + HTML parts (UTF-8, base64), ready for Gmail's users.messages.send. */
export function buildMime(m: { from: string; to: string; subject: string; text: string; html: string; replyTo?: string }) {
  const boundary = `vsm_${randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${clean(m.from)}`,
    `To: ${clean(m.to)}`,
    `Subject: ${encodeHeader(clean(m.subject))}`,
    ...(m.replyTo ? [`Reply-To: ${clean(m.replyTo)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body).replace(/.{76}/g, "$&\r\n")}\r\n`;
  const raw = `${headers.join("\r\n")}\r\n\r\n${part("text/plain", m.text)}${part("text/html", m.html)}--${boundary}--`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** The Google account chosen in Settings → Integrations → Google as the company sender. */
export async function gmailSenderConnection() {
  const { data } = await supabaseAdmin()
    .from("google_workspace_settings")
    .select("gmail_sender_employee_id")
    .not("gmail_sender_employee_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (!data?.gmail_sender_employee_id) return null;
  const c = await googleConnectionFor(data.gmail_sender_employee_id);
  return c && hasScope(c, "gmail") ? c : null;
}

export async function sendViaGmail(m: { from: string; to: string; subject: string; text: string; html: string; replyTo?: string }) {
  const c = await gmailSenderConnection();
  if (!c) throw new Error("No Gmail sender connected (Settings → Integrations → Google).");
  // Gmail always sends as the connected account; keep the display name from EMAIL_FROM.
  const display = m.from.match(/^(.*?)\s*</)?.[1]?.replace(/"/g, "") || "VSM Growth";
  const r = await googleFetch(c, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: buildMime({ ...m, from: `${display} <${c.account_email}>` }) }),
  });
  const j = (await r.json()) as { id?: string };
  return { messageId: j.id ?? null };
}
