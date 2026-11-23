import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { zonedInstant, localDate } from "@/lib/engines/time";
const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const stamp = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const fold = (s: string) => {
  const out: string[] = [];
  let line = "",
    bytes = 0;
  for (const ch of s) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 73) {
      out.push(line);
      line = " ";
      bytes = 1;
    }
    line += ch;
    bytes += n;
  }
  out.push(line);
  return out.join("\r\n");
};
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const from = req.nextUrl.searchParams.get("from") ?? localDate(new Date(Date.now() - 30 * 86400000), ctx.timezone),
    to = req.nextUrl.searchParams.get("to") ?? localDate(new Date(Date.now() + 90 * 86400000), ctx.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("calendar_events")
    .select("id,title,description,starts_at,ends_at,location,meeting_url,organizer_id")
    .gte("ends_at", zonedInstant(from, "00:00", ctx.timezone).toISOString())
    .lte("starts_at", zonedInstant(to, "23:59:59", ctx.timezone).toISOString())
    .neq("status", "CANCELLED")
    .order("starts_at")
    .limit(5000);
  if (error) return NextResponse.json({ error: "calendar export unavailable" }, { status: 500 });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VSM Growth//VSM Ops Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(data ?? []).flatMap((e: any) => [
      "BEGIN:VEVENT",
      `UID:${e.id}@ops.vsmgrowth.com`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(e.starts_at)}`,
      `DTEND:${stamp(e.ends_at)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(e.meeting_url ? [`URL:${e.meeting_url}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  const body = lines.map(fold).join("\r\n") + "\r\n";
  await sb.rpc("log_audit", {
    p_action: "calendar.ics_exported",
    p_entity: "calendar_events",
    p_entity_id: `${from}:${to}`,
    p_metadata: { rows: data?.length ?? 0 },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="vsm-ops-calendar-${from}-${to}.ics"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
