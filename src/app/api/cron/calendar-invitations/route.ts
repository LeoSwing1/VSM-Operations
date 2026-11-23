import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";
export const dynamic = "force-dynamic";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin(),
    provider = await getProvider();
  if (!provider) return NextResponse.json({ sent: 0, queued: true, reason: "Email provider is not configured" });
  const { data: claimed, error } = await sb.rpc("claim_calendar_email_deliveries", { p_limit: 50 });
  if (error) return NextResponse.json({ error: "queue unavailable" }, { status: 500 });
  const ids = (claimed ?? []).map((x: any) => x.id);
  const { data: items } = ids.length
    ? await sb
        .from("calendar_email_deliveries")
        .select(
          "id,org_id,event_id,attendee_id,email,attempts,event:calendar_events(title,description,starts_at,ends_at,location,meeting_url),person:employees!calendar_email_deliveries_attendee_id_fkey(full_name)",
        )
        .in("id", ids)
    : { data: [] };
  let sent = 0,
    failed = 0;
  for (const item of items ?? []) {
    const e = item.event as any,
      p = item.person as any;
    try {
      const start = new Date(e.starts_at).toLocaleString("en-IN", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
      });
      const end = new Date(e.ends_at).toLocaleString("en-IN", { timeStyle: "short", timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata" });
      const result = await provider.send({
        from: process.env.EMAIL_FROM ?? "VSM Growth <ops@vsmgrowth.com>",
        to: item.email,
        replyTo: process.env.EMAIL_REPLY_TO,
        subject: `Meeting invitation: ${e.title}`,
        text: `Hello ${p?.full_name ?? "there"},\n\nYou are invited to ${e.title}.\nWhen: ${start} – ${end} (Asia/Kolkata)\n${e.location ? `Location: ${e.location}\n` : ""}${e.meeting_url ? `Join: ${e.meeting_url}\n` : ""}${e.description ? `\n${e.description}\n` : ""}\nPlease sign in to VSM Ops to accept, decline or mark tentative.`,
        html: `<p>Hello ${esc(p?.full_name ?? "there")},</p><p>You are invited to <strong>${esc(e.title)}</strong>.</p><p><strong>When:</strong> ${esc(start)} – ${esc(end)} (Asia/Kolkata)</p>${e.location ? `<p><strong>Location:</strong> ${esc(e.location)}</p>` : ""}${e.meeting_url ? `<p><a href="${esc(e.meeting_url)}">Join meeting</a></p>` : ""}${e.description ? `<p>${esc(e.description).replace(/\n/g, "<br>")}</p>` : ""}<p>Sign in to VSM Ops to respond to this invitation.</p>`,
        refId: item.id,
        tags: ["calendar-invitation"],
      });
      await sb
        .from("calendar_email_deliveries")
        .update({
          status: "SENT",
          provider_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
        })
        .eq("id", item.id);
      sent++;
    } catch (err) {
      await sb
        .from("calendar_email_deliveries")
        .update({
          status: "FAILED",
          next_attempt_at: new Date(
            Date.now() + Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, item.attempts - 1)),
          ).toISOString(),
          locked_at: null,
          last_error: String((err as Error).message).slice(0, 500),
        })
        .eq("id", item.id);
      failed++;
    }
  }
  return NextResponse.json({ processed: (items ?? []).length, sent, failed });
}
