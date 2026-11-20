import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandLeave, summariseAttendance, type AttendanceEvent, type ShiftPolicy } from "@/lib/engines/attendance";
import { localDate, zonedInstant } from "@/lib/engines/time";

export const FALLBACK_SHIFT: ShiftPolicy = {
  start_time: "09:00", end_time: "18:00", grace_minutes: 10, half_day_minutes: 240, full_day_minutes: 480, weekly_offs: [0],
};

/** Loads everything the attendance engine needs for one employee. Runs under the caller's RLS. */
export async function loadAttendance(sb: SupabaseClient, employeeId: string, start: string, end: string, tz = "Asia/Kolkata") {
  const { data: emp } = await sb.from("employees")
    .select("id, joining_date, exit_date, shift:shifts(start_time,end_time,grace_minutes,half_day_minutes,full_day_minutes,weekly_offs)")
    .eq("id", employeeId).maybeSingle();
  if (!emp) return null;

  const [{ data: events }, { data: holidays }, { data: leaves }] = await Promise.all([
    sb.from("attendance_events").select("event_type, occurred_at, source").eq("employee_id", employeeId)
      .gte("occurred_at", zonedInstant(start, "00:00", tz).toISOString())
      .lte("occurred_at", zonedInstant(end, "23:59:59", tz).toISOString())
      .order("occurred_at"),
    sb.from("holidays").select("holiday_date").gte("holiday_date", start).lte("holiday_date", end),
    sb.from("leave_requests").select("start_date, end_date, half_day, leave_type:leave_types(is_paid)")
      .eq("employee_id", employeeId).eq("status", "APPROVED").lte("start_date", end).gte("end_date", start),
  ]);

  const shift = (Array.isArray(emp.shift) ? emp.shift[0] : emp.shift) as ShiftPolicy | null;
  const now = new Date();
  return summariseAttendance({
    events: (events ?? []) as AttendanceEvent[],
    shift: shift ?? FALLBACK_SHIFT,
    start, end,
    holidays: (holidays ?? []).map((h) => h.holiday_date as string),
    leave: expandLeave((leaves ?? []).map((l: any) => ({
      start_date: l.start_date, end_date: l.end_date, half_day: l.half_day,
      is_paid: (Array.isArray(l.leave_type) ? l.leave_type[0]?.is_paid : l.leave_type?.is_paid) ?? true,
    }))),
    joiningDate: emp.joining_date as string,
    exitDate: emp.exit_date as string | null,
    today: localDate(now, tz),
    nowIso: now.toISOString(),
    tz,
  });
}

export function minutesToHm(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}
