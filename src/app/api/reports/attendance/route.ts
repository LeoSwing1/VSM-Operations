import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAttendance, minutesToHm } from "@/lib/data/attendance";
import { fmtTime, monthBounds, localDate } from "@/lib/engines/time";

/** CSV attendance report. Same scope rules as the records themselves (RLS + explicit check). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const employeeId = p.get("employee") ?? ctx.employee_id;
  const { start, end } = monthBounds(p.get("month") ?? localDate(new Date(), ctx.timezone));
  if (employeeId !== ctx.employee_id && !can(ctx, "attendance.view_all") && !can(ctx, "attendance.view_team")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sb = await supabaseServer();
  const s = await loadAttendance(sb, employeeId, start, end, ctx.timezone);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });   // RLS hid it → not in caller's scope
  const rows = [["Date", "Status", "First in", "Last out", "Worked", "Break", "Late (min)", "Early leave (min)", "Missing clock-out", "LOP"]];
  for (const d of s.days) rows.push([d.date, d.status, d.firstIn ? fmtTime(d.firstIn, ctx.timezone) : "", d.lastOut ? fmtTime(d.lastOut, ctx.timezone) : "",
    minutesToHm(d.workedMinutes), minutesToHm(d.breakMinutes), String(d.lateMinutes), String(d.earlyDepartureMinutes), d.missingClockOut ? "yes" : "", String(d.lop)]);
  rows.push([], ["Working days", String(s.workingDays)], ["Present days", String(s.presentDays)], ["Attendance %", String(s.attendancePct ?? "")],
    ["Late arrivals", String(s.lateArrivals)], ["Loss of pay days", String(s.lopDays)]);
  const csv = rows.map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n");
  return new NextResponse(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="attendance-${start.slice(0, 7)}.csv"`,
    "Cache-Control": "private, no-store",
  } });
}
