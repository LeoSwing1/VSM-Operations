import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/integrations/calendar-crypto";
import { drainCalendarQueue } from "@/lib/google/calendar-queue";
export const dynamic = "force-dynamic";
async function refresh(provider: string, refreshToken: string) {
  const google = provider === "GOOGLE",
    url = google ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    id = google ? (process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CALENDAR_CLIENT_ID) : process.env.MICROSOFT_CALENDAR_CLIENT_ID,
    secret = google
      ? (process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CALENDAR_CLIENT_SECRET)
      : process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  if (!id || !secret) throw new Error("OAuth client credentials missing");
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Provider token refresh failed");
  return j;
}
function eventBody(provider: string, e: any) {
  return provider === "GOOGLE"
    ? {
        summary: e.title,
        description: [e.description, e.meeting_url ? `Meeting link: ${e.meeting_url}` : ""].filter(Boolean).join("\n\n"),
        location: e.location ?? undefined,
        start: { dateTime: e.starts_at },
        end: { dateTime: e.ends_at },
      }
    : {
        subject: e.title,
        body: {
          contentType: "text",
          content: [e.description, e.meeting_url ? `Meeting link: ${e.meeting_url}` : ""].filter(Boolean).join("\n\n"),
        },
        start: { dateTime: e.starts_at, dateTimeTimeZone: "UTC" },
        end: { dateTime: e.ends_at, dateTimeTimeZone: "UTC" },
        location: e.location ? { displayName: e.location } : undefined,
      };
}
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const queue = await drainCalendarQueue(50).catch((e: Error) => ({ calendarError: e.message }));
  const sb = supabaseAdmin(),
    { data: connections, error } = await sb.from("calendar_provider_connections").select("*").eq("sync_enabled", true).limit(200);
  if (error) return NextResponse.json({ error: "connection list unavailable" }, { status: 500 });
  let pushed = 0,
    pulled = 0,
    failed = 0;
  for (const c of connections ?? []) {
    try {
      let token = decryptToken(c.access_token_enc);
      if (!c.expires_at || new Date(c.expires_at).getTime() < Date.now() + 300000) {
        if (!c.refresh_token_enc) throw new Error("Reconnect calendar to refresh expired credentials");
        const refreshed = await refresh(c.provider, decryptToken(c.refresh_token_enc));
        token = refreshed.access_token;
        await sb
          .from("calendar_provider_connections")
          .update({
            access_token_enc: encryptToken(token),
            refresh_token_enc: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : c.refresh_token_enc,
            expires_at: new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
      }
      const now = new Date(),
        until = new Date(Date.now() + 90 * 86400000),
        google = c.provider === "GOOGLE";
      const { data: events } = await sb
        .from("calendar_events")
        .select("id,title,description,starts_at,ends_at,location,meeting_url,updated_at")
        .eq("org_id", c.org_id)
        .eq("organizer_id", c.employee_id)
        .eq("status", "SCHEDULED")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", until.toISOString())
        .order("starts_at")
        .limit(100);
      // Google: meetings are pushed per participant by the sync queue (drainCalendarQueue). Microsoft: organiser push here.
      for (const e of google ? [] : (events ?? [])) {
        const { data: link } = await sb
          .from("calendar_sync_links")
          .select("id,external_event_id,last_synced_at")
          .eq("event_id", e.id)
          .eq("employee_id", c.employee_id)
          .eq("provider", c.provider)
          .maybeSingle();
        if (link && new Date(e.updated_at) <= new Date(link.last_synced_at)) continue;
        const base = google
            ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
            : "https://graph.microsoft.com/v1.0/me/events",
          endpoint = link ? `${base}/${encodeURIComponent(link.external_event_id)}` : base,
          response = await fetch(endpoint, {
            method: link ? "PATCH" : "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(eventBody(c.provider, e)),
            cache: "no-store",
          });
        if (!response.ok) throw new Error(`Outbound event sync failed (${response.status})`);
        const payload = await response.json();
        if (link)
          await sb
            .from("calendar_sync_links")
            .update({
              external_etag: payload.etag ?? payload["@odata.etag"] ?? null,
              last_synced_at: new Date().toISOString(),
              sync_error: null,
            })
            .eq("id", link.id);
        else
          await sb.from("calendar_sync_links").insert({
            org_id: c.org_id,
            employee_id: c.employee_id,
            event_id: e.id,
            provider: c.provider,
            external_event_id: payload.id,
            external_etag: payload.etag ?? payload["@odata.etag"] ?? null,
          });
        pushed++;
      }
      // Pull external events into a private VSM Ops calendar. Imported rows are idempotent by provider event ID.
      const listUrl = google
        ? `${baseUrlGoogle()}?timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(until.toISOString())}&singleEvents=true&maxResults=100`
        : `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(now.toISOString())}&endDateTime=${encodeURIComponent(until.toISOString())}&$top=100`;
      const listRes = await fetch(listUrl, {
        headers: { authorization: `Bearer ${token}`, ...(!google ? { Prefer: 'outlook.timezone="UTC"' } : {}) },
        cache: "no-store",
      });
      if (!listRes.ok) throw new Error(`Inbound calendar sync failed (${listRes.status})`);
      const list = await listRes.json(),
        external = google ? (list.items ?? []) : (list.value ?? []);
      for (const x of external) {
        const externalId = x.id;
        if (!externalId || x.status === "cancelled" || x.isCancelled) continue;
        if (google && x.extendedProperties?.private?.vsmEventId) continue; // our own copy of a VSM meeting — never import it back
        const { data: known } = await sb
          .from("calendar_sync_links")
          .select("id,event_id,last_synced_at")
          .eq("employee_id", c.employee_id)
          .eq("provider", c.provider)
          .eq("external_event_id", externalId)
          .maybeSingle();
        if (known) {
          const externalUpdated = new Date(google ? (x.updated ?? 0) : (x.lastModifiedDateTime ?? 0)),
            lastSync = new Date(known.last_synced_at),
            { data: local } = await sb.from("calendar_events").select("updated_at").eq("id", known.event_id).maybeSingle();
          if (local && Number.isFinite(externalUpdated.getTime()) && externalUpdated > lastSync && new Date(local.updated_at) <= lastSync) {
            const s0 = google ? (x.start?.dateTime ?? x.start?.date) : x.start?.dateTime,
              e0 = google ? (x.end?.dateTime ?? x.end?.date) : x.end?.dateTime;
            if (s0 && e0) {
              await sb
                .from("calendar_events")
                .update({
                  title: String(google ? (x.summary ?? "Untitled calendar event") : (x.subject ?? "Untitled calendar event")).slice(0, 200),
                  description: String(google ? (x.description ?? "") : (x.bodyPreview ?? "")).slice(0, 3000),
                  starts_at: new Date(s0).toISOString(),
                  ends_at: new Date(e0).toISOString(),
                  location: google ? (x.location ?? null) : (x.location?.displayName ?? null),
                })
                .eq("id", known.event_id);
              await sb
                .from("calendar_sync_links")
                .update({ last_synced_at: new Date().toISOString(), external_etag: x.etag ?? x["@odata.etag"] ?? null })
                .eq("id", known.id);
            }
          }
          continue;
        }
        const title = String(google ? (x.summary ?? "Untitled calendar event") : (x.subject ?? "Untitled calendar event")).slice(0, 200),
          startRaw = google ? (x.start?.dateTime ?? x.start?.date) : x.start?.dateTime,
          endRaw = google ? (x.end?.dateTime ?? x.end?.date) : x.end?.dateTime;
        if (!startRaw || !endRaw) continue;
        const starts = new Date(startRaw),
          ends = new Date(endRaw);
        if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) continue;
        const { data: existing } = await sb
          .from("calendar_events")
          .select("id")
          .eq("org_id", c.org_id)
          .eq("organizer_id", c.employee_id)
          .eq("title", title)
          .eq("starts_at", starts.toISOString())
          .maybeSingle();
        let eventId = existing?.id;
        if (!eventId) {
          const description = String(google ? (x.description ?? "") : (x.bodyPreview ?? "")).slice(0, 3000);
          const { data: created, error: createError } = await sb
            .from("calendar_events")
            .insert({
              org_id: c.org_id,
              title,
              description: description.slice(0, 3000),
              event_type: "OTHER",
              visibility: "PRIVATE",
              starts_at: starts.toISOString(),
              ends_at: ends.toISOString(),
              location: google ? (x.location ?? null) : (x.location?.displayName ?? null),
              meeting_url: null,
              organizer_id: c.employee_id,
              external_source: google ? "GOOGLE" : "MICROSOFT",
            })
            .select("id")
            .single();
          if (createError || !created) continue;
          eventId = created.id;
          await sb
            .from("calendar_attendees")
            .insert({ event_id: eventId, org_id: c.org_id, employee_id: c.employee_id, response: "ACCEPTED" });
        }
        await sb.from("calendar_sync_links").insert({
          org_id: c.org_id,
          employee_id: c.employee_id,
          event_id: eventId,
          provider: c.provider,
          external_event_id: externalId,
          external_etag: x.etag ?? x["@odata.etag"] ?? null,
        });
        pulled++;
      }
      await sb.from("calendar_provider_connections").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", c.id);
    } catch (err) {
      failed++;
      await sb
        .from("calendar_provider_connections")
        .update({ updated_at: new Date().toISOString(), last_error: String((err as Error).message).slice(0, 500) })
        .eq("id", c.id);
    }
  }
  return NextResponse.json({ connections: connections?.length ?? 0, pushed, pulled, failed, ...queue });
}
function baseUrlGoogle() {
  return "https://www.googleapis.com/calendar/v3/calendars/primary/events";
}
