/** Salary day helpers (mirror default_salary_day() / next_salary_date() in migration 0040). Dates are YYYY-MM-DD. */
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Default pay day = the day of (joining date + 7 days). Joins 1 Jan → 8th. */
export function defaultSalaryDay(joining: string): number {
  const d = new Date(joining + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7);
  return d.getUTCDate();
}

/** Next salary date on or after `from`, with the day clamped to the month's last day. */
export function nextSalaryDate(day: number, from: string): string {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  const thisMonth = Math.min(day, daysIn(y, m));
  if (thisMonth >= d) return `${y}-${pad(m)}-${pad(thisMonth)}`;
  const ny = m === 12 ? y + 1 : y,
    nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, daysIn(ny, nm)))}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
