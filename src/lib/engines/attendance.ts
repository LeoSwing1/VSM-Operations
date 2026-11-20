import { DEFAULT_TZ, eachDate, localDate, localMinutes, timeToMinutes, weekday } from "./time";

export type AttendanceEventType = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
export interface AttendanceEvent { event_type: AttendanceEventType; occurred_at: string; source?: string }
export interface ShiftPolicy {
  start_time: string;        // "09:00"
  end_time: string;          // "18:00"
  grace_minutes: number;
  half_day_minutes: number;  // worked minutes ≥ this → at least half day
  full_day_minutes: number;  // worked minutes ≥ this → full day
  weekly_offs: number[];     // 0 = Sunday
}
export interface LeaveDay { date: string; paid: boolean; half: boolean }

export type DayStatus =
  | "PRESENT" | "HALF_DAY" | "ABSENT" | "INCOMPLETE" | "LEAVE" | "HALF_LEAVE"
  | "HOLIDAY" | "WEEKLY_OFF" | "NOT_EMPLOYED" | "UPCOMING";

export interface DaySummary {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  missingClockOut: boolean;
  isWorkingDay: boolean;
  /** Fraction of the day that is unpaid (loss of pay): 0, 0.5 or 1 */
  lop: number;
  leavePaid: boolean | null;
}

export interface AttendanceSummary {
  days: DaySummary[];
  workingDays: number;
  presentDays: number;      // full + 0.5 × half
  absentDays: number;
  halfDays: number;
  lateArrivals: number;
  earlyDepartures: number;
  missingClockOuts: number;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  leaveDays: number;
  lopDays: number;
  attendancePct: number | null;   // null when there were no working days yet
  punctualityPct: number | null;
}

/** Pair a single day's events into worked/break minutes. Robust to odd sequences. */
export function summariseDayEvents(events: AttendanceEvent[], nowIso?: string) {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let worked = 0, breaks = 0;
  let inAt: number | null = null, breakAt: number | null = null;
  let firstIn: string | null = null, lastOut: string | null = null;
  for (const e of sorted) {
    const t = Date.parse(e.occurred_at);
    switch (e.event_type) {
      case "CLOCK_IN":
        if (inAt === null) { inAt = t; firstIn ??= e.occurred_at; }
        break;
      case "BREAK_START":
        if (inAt !== null && breakAt === null) breakAt = t;
        break;
      case "BREAK_END":
        if (breakAt !== null) { breaks += t - breakAt; breakAt = null; }
        break;
      case "CLOCK_OUT":
        if (inAt !== null) {
          if (breakAt !== null) { breaks += t - breakAt; breakAt = null; }
          worked += t - inAt; inAt = null; lastOut = e.occurred_at;
        }
        break;
    }
  }
  const open = inAt !== null;
  if (open && nowIso) {
    // Live day: count time so far, but flag as still open.
    const now = Date.parse(nowIso);
    if (breakAt !== null) breaks += now - breakAt;
    worked += now - (inAt as number);
  }
  const workedMinutes = Math.max(0, Math.round((worked - breaks) / 60000));
  return { firstIn, lastOut, workedMinutes, breakMinutes: Math.round(breaks / 60000), open };
}

export function summariseAttendance(input: {
  events: AttendanceEvent[];
  shift: ShiftPolicy;
  start: string; end: string;           // inclusive local dates
  holidays: string[];
  leave: LeaveDay[];
  joiningDate: string;
  exitDate?: string | null;
  today: string;                        // local date "now"
  nowIso?: string;
  tz?: string;
}): AttendanceSummary {
  const tz = input.tz ?? DEFAULT_TZ;
  const byDay = new Map<string, AttendanceEvent[]>();
  for (const e of input.events) {
    const d = localDate(e.occurred_at, tz);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e);
  }
  const holidays = new Set(input.holidays);
  const leave = new Map(input.leave.map((l) => [l.date, l]));
  const shiftStart = timeToMinutes(input.shift.start_time);
  const shiftEnd = timeToMinutes(input.shift.end_time);

  const days: DaySummary[] = eachDate(input.start, input.end).map((date) => {
    const ev = byDay.get(date) ?? [];
    const isToday = date === input.today;
    const s = summariseDayEvents(ev, isToday ? input.nowIso : undefined);
    const base: DaySummary = {
      date, status: "ABSENT", firstIn: s.firstIn, lastOut: s.lastOut,
      workedMinutes: s.workedMinutes, breakMinutes: s.breakMinutes,
      lateMinutes: 0, earlyDepartureMinutes: 0, missingClockOut: false,
      isWorkingDay: false, lop: 0, leavePaid: null,
    };
    if (date < input.joiningDate || (input.exitDate && date > input.exitDate)) return { ...base, status: "NOT_EMPLOYED" };
    if (holidays.has(date)) return { ...base, status: "HOLIDAY" };
    if (input.shift.weekly_offs.includes(weekday(date))) return { ...base, status: "WEEKLY_OFF" };
    if (date > input.today) return { ...base, status: "UPCOMING", isWorkingDay: false };

    base.isWorkingDay = true;
    if (s.firstIn) {
      const late = localMinutes(s.firstIn, tz) - (shiftStart + input.shift.grace_minutes);
      base.lateMinutes = Math.max(0, late);
      if (s.lastOut && !s.open) base.earlyDepartureMinutes = Math.max(0, shiftEnd - localMinutes(s.lastOut, tz));
    }
    const l = leave.get(date);
    if (s.open && !isToday) {
      base.missingClockOut = true;
      return { ...base, status: "INCOMPLETE", lop: l ? (l.paid ? 0 : 1) : 0.5 };
    }
    if (isToday && s.open) return { ...base, status: "PRESENT" };   // in progress, judged at end of day

    const fullDay = s.workedMinutes >= input.shift.full_day_minutes;
    const halfDay = !fullDay && s.workedMinutes >= input.shift.half_day_minutes;

    if (l && !l.half) return { ...base, status: "LEAVE", leavePaid: l.paid, lop: l.paid ? 0 : 1 };
    if (l && l.half) {
      // half leave + at least half day worked = complete day
      const workedPart = s.workedMinutes >= input.shift.half_day_minutes ? 0.5 : 0;
      return { ...base, status: "HALF_LEAVE", leavePaid: l.paid, lop: (l.paid ? 0 : 0.5) + (0.5 - workedPart) };
    }
    if (fullDay) return { ...base, status: "PRESENT" };
    if (halfDay) return { ...base, status: "HALF_DAY", lop: 0.5 };
    if (isToday && !s.firstIn) return { ...base, status: "UPCOMING", isWorkingDay: false };
    return { ...base, status: "ABSENT", lop: 1 };
  });

  const working = days.filter((d) => d.isWorkingDay);
  const present = working.filter((d) => d.status === "PRESENT").length;
  const half = working.filter((d) => d.status === "HALF_DAY").length;
  const arrived = working.filter((d) => d.firstIn);
  const late = arrived.filter((d) => d.lateMinutes > 0).length;
  const leaveDays = working.reduce((n, d) => n + (d.status === "LEAVE" ? 1 : d.status === "HALF_LEAVE" ? 0.5 : 0), 0);
  const presentDays = present + half * 0.5 + working.filter((d) => d.status === "HALF_LEAVE" && d.workedMinutes >= input.shift.half_day_minutes).length * 0.5
    + working.filter((d) => d.status === "INCOMPLETE").length * 0.5;
  const expected = working.length - leaveDays;

  return {
    days,
    workingDays: working.length,
    presentDays,
    absentDays: working.filter((d) => d.status === "ABSENT").length,
    halfDays: half,
    lateArrivals: late,
    earlyDepartures: working.filter((d) => d.earlyDepartureMinutes > 0).length,
    missingClockOuts: working.filter((d) => d.missingClockOut).length,
    totalWorkedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
    totalBreakMinutes: days.reduce((n, d) => n + d.breakMinutes, 0),
    leaveDays,
    lopDays: working.reduce((n, d) => n + d.lop, 0),
    attendancePct: expected > 0 ? round1((presentDays / expected) * 100) : null,
    punctualityPct: arrived.length > 0 ? round1(((arrived.length - late) / arrived.length) * 100) : null,
  };
}

/** Expand approved leave requests into per-day entries. */
export function expandLeave(reqs: { start_date: string; end_date: string; half_day: boolean; is_paid: boolean }[]): LeaveDay[] {
  return reqs.flatMap((r) => eachDate(r.start_date, r.end_date).map((date) => ({ date, paid: r.is_paid, half: r.half_day })));
}

/** What the punch button should offer next. */
export function nextActions(todayEvents: AttendanceEvent[]): AttendanceEventType[] {
  const last = [...todayEvents].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  if (!last || last.event_type === "CLOCK_OUT") return ["CLOCK_IN"];
  if (last.event_type === "BREAK_START") return ["BREAK_END"];
  return ["BREAK_START", "CLOCK_OUT"];
}

function round1(n: number) { return Math.round(n * 10) / 10; }
