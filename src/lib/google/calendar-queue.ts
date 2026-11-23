import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { googleConnectionFor, googleFetch, hasScope } from "./oauth";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const BACKOFF_MIN = [1, 5, 15, 60, 240];

/** Google event body for a VSM meeting. No attendees are added, so Google never emails anyone — each person gets their own copy. */
export function googleEventBody(
  e: {
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    location: string | null;
    meeting_url: string | null;
  },
  appUrl: string,
) {
  const day = (iso: string) => iso.slice(0, 10);
  return {
    summary: e.title,
    description: [e.description, e.meeting_url ? `Join: ${e.meeting_url}` : "", `Open in VSM Ops: ${appUrl}/calendar`]
      .filter(Boolean)
      .join("\n\n"),
    location: e.location ?? undefined,
    start: e.all_day ? { date: day(e.starts_at) } : { dateTime: e.starts_at },
    end: e.all_day ? { date: day(e.ends_at) } : { dateTime: e.ends_at },
    extendedProperties: { private: { vsmEventId: e.id } },
    source: { title: "VSM Ops", url: `${appUrl}/calendar` },
    reminders: { useDefault: true },
  };
}

/** Pushes queued meeting changes to each participant's own Google Calendar. */
export async function drainCalendarQueue(limit = 25) {
  const sb = supabaseAdmin();
  const { data: jobs, error } = await sb.rpc("claim_calendar_sync", { p_limit: limit });
  if (error) throw new Error(error.message);
  const appUrl = process.env.APP_URL ?? "https://ops.vsmgrowth.com";
  let done = 0,
    failed = 0,
    skipped = 0;
  for (const j of (jobs ?? []) as { id: number; event_id: string; employee_id: string; op: "UPSERT" | "DELETE"; attempts: number }[]) {
    try {
      const conn = await googleConnectionFor(j.employee_id);
      if (!conn || !hasScope(conn, "calendar")) {
        await sb
          .from("calendar_sync_queue")
          .update({ status: "SKIPPED", done_at: new Date().toISOString(), last_error: "No Google Calendar connection" })
          .eq("id", j.id);
        skipped++;
        continue;
      }
      const { data: link } = await sb
        .from("calendar_sync_links")
        .select("id, external_event_id")
        .eq("event_id", j.event_id)
        .eq("employee_id", j.employee_id)
        .eq("provider", "GOOGLE")
        .maybeSingle();
      const { data: ev } = await sb
        .from("calendar_events")
        .select("id, title, description, starts_at, ends_at, all_day, location, meeting_url, status")
        .eq("id", j.event_id)
        .maybeSingle();
      const stillInvited =
        ev &&
        (
          await sb
            .from("calendar_attendees")
            .select("employee_id")
            .eq("event_id", j.event_id)
            .eq("employee_id", j.employee_id)
            .maybeSingle()
        ).data;
      const isOrganizer =
        ev && (await sb.from("calendar_events").select("organizer_id").eq("id", j.event_id).single()).data?.organizer_id === j.employee_id;
      const remove = j.op === "DELETE" || !ev || ev.status === "CANCELLED" || (!stillInvited && !isOrganizer);
      if (remove) {
        if (link) {
          await googleFetch(conn, `${BASE}/${encodeURIComponent(link.external_event_id)}`, { method: "DELETE" });
          await sb.from("calendar_sync_links").delete().eq("id", link.id);
        }
      } else {
        const body = JSON.stringify(googleEventBody(ev!, appUrl));
        const r = link
          ? await googleFetch(conn, `${BASE}/${encodeURIComponent(link.external_event_id)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body,
            })
          : await googleFetch(conn, BASE, { method: "POST", headers: { "content-type": "application/json" }, body });
        if (link && (r.status === 404 || r.status === 410)) {
          // Deleted on Google's side — recreate.
          await sb.from("calendar_sync_links").delete().eq("id", link.id);
          const again = await googleFetch(conn, BASE, { method: "POST", headers: { "content-type": "application/json" }, body });
          const g = (await again.json()) as { id: string; etag?: string };
          await sb.from("calendar_sync_links").insert({
            org_id: conn.org_id,
            employee_id: j.employee_id,
            event_id: j.event_id,
            provider: "GOOGLE",
            external_event_id: g.id,
            external_etag: g.etag ?? null,
          });
        } else {
          const g = (await r.json()) as { id: string; etag?: string };
          if (link)
            await sb
              .from("calendar_sync_links")
              .update({ external_etag: g.etag ?? null, last_synced_at: new Date().toISOString(), sync_error: null })
              .eq("id", link.id);
          else
            await sb.from("calendar_sync_links").insert({
              org_id: conn.org_id,
              employee_id: j.employee_id,
              event_id: j.event_id,
              provider: "GOOGLE",
              external_event_id: g.id,
              external_etag: g.etag ?? null,
            });
        }
      }
      await sb.from("calendar_sync_queue").update({ status: "DONE", done_at: new Date().toISOString(), last_error: null }).eq("id", j.id);
      done++;
    } catch (e) {
      failed++;
      const final = j.attempts >= BACKOFF_MIN.length;
      await sb
        .from("calendar_sync_queue")
        .update({
          status: final ? "FAILED" : "QUEUED",
          last_error: (e as Error).message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + (BACKOFF_MIN[Math.min(j.attempts, BACKOFF_MIN.length - 1)] ?? 240) * 60_000).toISOString(),
        })
        .eq("id", j.id);
    }
  }
  return { calendarPushed: done, calendarFailed: failed, calendarSkipped: skipped };
}
