/** Pure helpers for OKRs and KPIs (mirrors okr_kr_progress / okr_objective_progress in migration 0032). */

export type Confidence = "ON_TRACK" | "AT_RISK" | "OFF_TRACK";

/** Indian financial-year quarter containing `date` (Q1 = Apr–Jun … Q4 = Jan–Mar). */
export function fyQuarter(date: string): { start: string; end: string; label: string; key: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  const fyStart = m >= 4 ? y : y - 1;
  const startMonth = q === 4 ? 1 : 4 + (q - 1) * 3;
  const startYear = q === 4 ? fyStart + 1 : fyStart;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(startYear, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${startYear}-${pad(startMonth)}-01`,
    end: `${startYear}-${pad(endMonth)}-${pad(lastDay)}`,
    label: `Q${q} FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`,
    key: `${fyStart}Q${q}`,
  };
}

/** Shift a quarter by n quarters, returning the quarter that contains the shifted month. */
export function shiftQuarter(start: string, n: number): ReturnType<typeof fyQuarter> {
  const [y, m] = start.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n * 3, 15));
  return fyQuarter(d.toISOString().slice(0, 10));
}

export function krProgress(start: number, target: number, current: number): number {
  if (target === start) return 0;
  const p = (current - start) / (target - start);
  return Math.round(Math.max(0, Math.min(1, p)) * 1000) / 10;
}

export function objectiveProgress(
  krs: { start_value: number; target_value: number; current_value: number; weight: number }[],
): number | null {
  if (!krs.length) return null;
  const w = krs.reduce((s, k) => s + Number(k.weight), 0);
  if (!w) return null;
  const sum = krs.reduce(
    (s, k) => s + krProgress(Number(k.start_value), Number(k.target_value), Number(k.current_value)) * Number(k.weight),
    0,
  );
  return Math.round((sum / w) * 10) / 10;
}

/** How far through the period we are (0–100), to compare progress with time elapsed. */
export function timeElapsed(start: string, end: string, today: string): number {
  const s = Date.parse(start + "T00:00:00Z"),
    e = Date.parse(end + "T23:59:59Z"),
    t = Date.parse(today + "T12:00:00Z");
  if (t <= s) return 0;
  if (t >= e) return 100;
  return Math.round(((t - s) / (e - s)) * 100);
}

/** Suggested confidence: progress at least 85% of the time elapsed is on track; under 50% is off track. */
export function suggestedConfidence(progress: number, elapsed: number): Confidence {
  if (elapsed <= 10) return "ON_TRACK";
  const ratio = progress / elapsed;
  return ratio >= 0.85 ? "ON_TRACK" : ratio >= 0.5 ? "AT_RISK" : "OFF_TRACK";
}

export function kpiStatus(
  value: number | null,
  target: number | null,
  direction: "HIGHER" | "LOWER",
): "MET" | "BELOW" | "NO_TARGET" | "NO_DATA" {
  if (value === null || value === undefined) return "NO_DATA";
  if (target === null || target === undefined) return "NO_TARGET";
  return (direction === "HIGHER" ? value >= target : value <= target) ? "MET" : "BELOW";
}

export const KPI_SOURCES: Record<string, string> = {
  MANUAL: "Entered by hand (manager verifies)",
  TASKS_COMPLETED: "Tasks completed",
  TASKS_ON_TIME_PCT: "Tasks completed on time (%)",
  TASK_QUALITY_AVG: "Average task quality score",
  ATTENDANCE_DAYS: "Days clocked in",
  DAILY_UPDATES: "Daily updates submitted",
  LEADS_CONTACTED: "Leads contacted (CRM)",
  LEADS_WON: "Leads won (CRM)",
  SCHOLAR_ADMISSIONS: "VSM Scholars admissions",
  PROJECT_HOURS: "Approved project hours",
};

export const REVIEW_RELATIONS: Record<string, string> = {
  SELF: "Self review",
  MANAGER: "Manager",
  PEER: "Peer",
  REPORT: "Direct report",
};
