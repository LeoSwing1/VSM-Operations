import { NextResponse, type NextRequest } from "next/server";
import { drainOutbox } from "@/lib/email/worker";
import { drainDeliveries } from "@/lib/delivery/worker";
import { drainCalendarQueue } from "@/lib/google/calendar-queue";
import { cronAuthorized, cronHeartbeat } from "@/lib/cron";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Every 5 minutes: drains the email outbox AND the delivery queue (WhatsApp, push, Slack, Teams,
 * webhooks) so a single cron job is enough on Vercel Hobby / cron-job.org. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // Queue "you have unread messages" emails for chats unseen 2+ hours (sent in the drain below).
    const { data: chatReminders } = await supabaseAdmin().rpc("chat_send_unread_reminders", { p_hours: 2 });
    const [email, deliveries, calendar] = await Promise.all([
      drainOutbox(50),
      drainDeliveries(100),
      drainCalendarQueue(25).catch((e: Error) => ({ calendarError: e.message })),
    ]);
    await cronHeartbeat(true);
    return NextResponse.json({ chatReminders: chatReminders ?? 0, email, deliveries, calendar });
  } catch (e) {
    await cronHeartbeat(false, (e as Error).message);
    return NextResponse.json({ error: "drain failed" }, { status: 500 });
  }
}
