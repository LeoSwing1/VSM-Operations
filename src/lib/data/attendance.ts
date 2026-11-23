import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandLeave, summariseAttendance, type AttendanceEvent, type ShiftPolicy } from "@/lib/engines/attendance";
import { localDate, zonedInstant } from "@/lib/engines/time";

export const FALLBACK_SHIFT: ShiftPolicy = {
  start_time: "09:00",
  end_time: "18:00",
  grace_minutes: 10,
  half_day_minutes: 240,
  full_day_minutes: 480,
  weekly_offs: [0],
};

/** Loads everything the attendance engine needs for one employee. Runs under the caller's RLS. */
export async function loadAttendance(sb: SupabaseClient, employeeId: string, start: string, end: string, tz = "Asia/Kolkata") {
  const { data: emp } = await sb
    .from("employees")
    .select("id, joining_date, exit_date, shift:shifts(start_time,end_time,grace_minutes,half_day_minutes,full_day_minutes,weekly_offs)")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return null;

  const [{ data: events }, { data: holidays }, { data: leaves }, { data: assignments }] = await Promise.all([
    sb
      .from("attendance_events")
      .select("event_type, occurred_at, source")
      .eq("employee_id", employeeId)
      .gte("occurred_at", zonedInstant(start, "00:00", tz).toISOString())
      .lte("occurred_at", zonedInstant(end, "23:59:59", tz).toISOString())
      .order("occurred_at"),
    sb.from("holidays").select("holiday_date").gte("holiday_date", start).lte("holiday_date", end),
    sb
      .from("leave_requests")
      .select("start_date, end_date, half_day, leave_type:leave_types(is_paid)")
      .eq("employee_id", employeeId)
      .eq("status", "APPROVED")
      .lte("start_date", end)
      .gte("end_date", start),
    sb
      .from("schedule_assignments")
      .select("effective_from,effective_to,shift:shifts(start_time,end_time,grace_minutes,half_day_minutes,full_day_minutes,weekly_offs)")
      .eq("employee_id", employeeId)
      .lte("effective_from", end)
      .or(`effective_to.is.null,effective_to.gte.${start}`)
      .order("effective_from"),
  ]);

  const shift = (Array.isArray(emp.shift) ? emp.shift[0] : emp.shift) as ShiftPolicy | null;
  const shiftByDate: Record<string, ShiftPolicy> = {};
  for (const a of assignments ?? []) {
    const policy = (Array.isArray(a.shift) ? a.shift[0] : a.shift) as ShiftPolicy | null;
    if (!policy) continue;
    const from = a.effective_from as string,
      to = (a.effective_to as string | null) ?? end;
    for (let d = from > start ? from : start; d <= (to < end ? to : end);) {
      shiftByDate[d] = policy;
      const dt = new Date(`${d}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
  }
  const now = new Date();
  return summariseAttendance({
    events: (events ?? []) as AttendanceEvent[],
    shift: shift ?? FALLBACK_SHIFT,
    shiftByDate,
    start,
    end,
    holidays: (holidays ?? []).map((h) => h.holiday_date as string),
    leave: expandLeave(
      (leaves ?? []).map((l: any) => ({
        start_date: l.start_date,
        end_date: l.end_date,
        half_day: l.half_day,
        is_paid: (Array.isArray(l.leave_type) ? l.leave_type[0]?.is_paid : l.leave_type?.is_paid) ?? true,
      })),
    ),
    joiningDate: emp.joining_date as string,
    exitDate: emp.exit_date as string | null,
    today: localDate(now, tz),
    nowIso: now.toISOString(),
    tz,
  });
}

export function minutesToHm(m: number) {
  const h = Math.floor(m / 60),
    mm = m % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}
