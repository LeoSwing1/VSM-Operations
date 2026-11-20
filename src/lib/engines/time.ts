import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "Asia/Kolkata";

/** YYYY-MM-DD of an instant in the given timezone. */
export function localDate(instant: Date | string, tz = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(instant), tz, "yyyy-MM-dd");
}

/** Minutes since local midnight for an instant in the given timezone. */
export function localMinutes(instant: Date | string, tz = DEFAULT_TZ): number {
  const hm = formatInTimeZone(new Date(instant), tz, "HH:mm");
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** "09:30" | "09:30:00" → 570 */
export function timeToMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

/** UTC instant for a local wall-clock time on a local date. */
export function zonedInstant(date: string, time: string, tz = DEFAULT_TZ): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? time + ":00" : time}`, tz);
}

/** Inclusive list of YYYY-MM-DD dates. Pure calendar arithmetic (no TZ drift). */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function maxDate(a: string, b: string) { return a > b ? a : b; }
export function minDate(a: string, b: string) { return a < b ? a : b; }

export function fmtDateTime(instant: string | Date, tz = DEFAULT_TZ) {
  return formatInTimeZone(new Date(instant), tz, "dd MMM yyyy, hh:mm a");
}
export function fmtTime(instant: string | Date, tz = DEFAULT_TZ) {
  return formatInTimeZone(new Date(instant), tz, "hh:mm a");
}
export function fmtDate(date: string) {
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "dd MMM yyyy");
}

/** First/last day of the month containing `date` (YYYY-MM-DD). */
export function monthBounds(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}
