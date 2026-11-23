/**
 * Performance engine. Transparent by design: every component reports its formula,
 * its inputs and the records it was computed from. Missing data is never scored as 100 —
 * it is excluded and reduces `coverage`; below the policy's minimum coverage the score is null.
 */
export const METRIC_KEYS = [
  "task_completion",
  "task_quality",
  "on_time_delivery",
  "productivity",
  "attendance",
  "daily_updates",
  "manager_review",
  "rework",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Weights = Partial<Record<MetricKey, number>>;

export const DEFAULT_WEIGHTS: Weights = {
  task_completion: 20,
  task_quality: 25,
  on_time_delivery: 15,
  productivity: 15,
  attendance: 10,
  daily_updates: 5,
  manager_review: 10,
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  task_completion: "Task completion",
  task_quality: "Task quality",
  on_time_delivery: "On-time delivery",
  productivity: "Productivity",
  attendance: "Attendance & punctuality",
  daily_updates: "Daily updates",
  manager_review: "Manager review",
  rework: "First-time-right (low rework)",
};

export type Category = "EXCEPTIONAL" | "EXCELLENT" | "GOOD" | "NEEDS_IMPROVEMENT" | "UNSATISFACTORY";
export const DEFAULT_THRESHOLDS = { EXCEPTIONAL: 90, EXCELLENT: 80, GOOD: 65, NEEDS_IMPROVEMENT: 50 };

export interface TaskInput {
  id: string;
  status: string;
  deadline: string | null;
  completed_at: string | null;
  submitted_at?: string | null;
  quality_score: number | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  reopen_count: number;
  created_at: string;
}

export interface PerformanceInput {
  periodStart: string;
  periodEnd: string; // YYYY-MM-DD
  tasks: TaskInput[];
  attendance: { attendancePct: number | null; punctualityPct: number | null; presentDays: number; workingDays: number };
  dailyUpdatesSubmitted: number;
  managerRating: number | null;
}

export interface Component {
  key: MetricKey;
  label: string;
  weight: number;
  score: number | null; // 0–100, null = no data
  contribution: number | null; // weight-normalised points
  formula: string;
  detail: string;
  sources: string[]; // record ids
}

export interface PerformanceResult {
  score: number | null;
  category: Category | null;
  coverage: number; // % of configured weight backed by data
  components: Component[];
  insufficientData: boolean;
  improvements: string[];
  validation: string[];
}

export function validateWeights(w: Weights): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(w)) {
    if (!(METRIC_KEYS as readonly string[]).includes(k)) errors.push(`Unknown metric "${k}"`);
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(`Weight for ${k} must be a non-negative number`);
  }
  const total = Object.values(w).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (Math.abs(total - 100) > 1e-9) errors.push(`Weights must total 100% (currently ${round(total)}%)`);
  return errors;
}

export function categorise(score: number | null, t = DEFAULT_THRESHOLDS): Category | null {
  if (score === null) return null;
  if (score >= t.EXCEPTIONAL) return "EXCEPTIONAL";
  if (score >= t.EXCELLENT) return "EXCELLENT";
  if (score >= t.GOOD) return "GOOD";
  if (score >= t.NEEDS_IMPROVEMENT) return "NEEDS_IMPROVEMENT";
  return "UNSATISFACTORY";
}

export function computePerformance(
  input: PerformanceInput,
  weights: Weights = DEFAULT_WEIGHTS,
  opts: { minCoverage?: number; thresholds?: typeof DEFAULT_THRESHOLDS } = {},
): PerformanceResult {
  const validation = validateWeights(weights);
  const minCoverage = opts.minCoverage ?? 60;
  const periodEndTs = Date.parse(`${input.periodEnd}T23:59:59.999+05:30`);
  const periodStartTs = Date.parse(`${input.periodStart}T00:00:00+05:30`);

  // De-duplicate and exclude cancelled work.
  const seen = new Set<string>();
  const tasks = input.tasks.filter((t) => t.status !== "CANCELLED" && !seen.has(t.id) && seen.add(t.id));

  // Tasks that were due in the period, or completed in it.
  const inPeriod = (iso: string | null) => !!iso && Date.parse(iso) >= periodStartTs && Date.parse(iso) <= periodEndTs;
  const accountable = tasks.filter((t) => inPeriod(t.deadline) || inPeriod(t.completed_at));
  const completed = accountable.filter((t) => t.status === "COMPLETED" && inPeriod(t.completed_at));
  const withDeadline = completed.filter((t) => t.deadline);
  const onTime = withDeadline.filter(
    (t) =>
      Date.parse(t.completed_at!) <= Date.parse(t.deadline!) || (t.submitted_at && Date.parse(t.submitted_at) <= Date.parse(t.deadline!)),
  );
  const reviewed = completed.filter((t) => t.quality_score !== null);
  const hoursTasks = completed.filter((t) => (t.estimated_hours ?? 0) > 0 && (t.actual_hours ?? 0) > 0);

  const raw: Record<MetricKey, Omit<Component, "key" | "label" | "weight" | "contribution">> = {
    task_completion: accountable.length
      ? {
          score: pct(completed.length, accountable.length),
          formula: "completed ÷ accountable tasks",
          detail: `${completed.length} of ${accountable.length} tasks completed`,
          sources: accountable.map((t) => t.id),
        }
      : none("No tasks due or completed in this period"),
    on_time_delivery: withDeadline.length
      ? {
          score: pct(onTime.length, withDeadline.length),
          formula: "submitted by deadline ÷ completed tasks with a deadline",
          detail: `${onTime.length} of ${withDeadline.length} on time`,
          sources: withDeadline.map((t) => t.id),
        }
      : none("No completed tasks with deadlines"),
    task_quality: reviewed.length
      ? {
          score: round(avg(reviewed.map((t) => t.quality_score!))),
          formula: "average reviewer quality score",
          detail: `${reviewed.length} reviewed task(s)`,
          sources: reviewed.map((t) => t.id),
        }
      : none("No reviewed tasks — completion alone is not treated as quality"),
    rework: completed.length
      ? {
          score: pct(completed.filter((t) => t.reopen_count === 0).length, completed.length),
          formula: "completed without being sent back ÷ completed",
          detail: `${completed.filter((t) => t.reopen_count > 0).length} task(s) needed rework`,
          sources: completed.map((t) => t.id),
        }
      : none("No completed tasks"),
    productivity: hoursTasks.length
      ? (() => {
          const est = sum(hoursTasks.map((t) => t.estimated_hours!)),
            act = sum(hoursTasks.map((t) => t.actual_hours!));
          return {
            score: Math.min(100, round((est / act) * 100)),
            formula: "estimated ÷ actual hours on completed tasks (capped at 100)",
            detail: `${round(est)}h estimated vs ${round(act)}h actual`,
            sources: hoursTasks.map((t) => t.id),
          };
        })()
      : none("No completed tasks with both estimated and actual hours"),
    attendance:
      input.attendance.attendancePct !== null
        ? (() => {
            const p = input.attendance.punctualityPct;
            const s = p === null ? input.attendance.attendancePct! : 0.7 * input.attendance.attendancePct! + 0.3 * p;
            return {
              score: round(Math.min(100, s)),
              formula: "70% presence + 30% punctuality",
              detail: `${input.attendance.attendancePct}% present, ${p ?? "–"}% on time`,
              sources: [],
            };
          })()
        : none("No working days in period"),
    daily_updates:
      input.attendance.presentDays > 0
        ? {
            score: Math.min(100, pct(input.dailyUpdatesSubmitted, Math.ceil(input.attendance.presentDays))),
            formula: "updates submitted ÷ days present",
            detail: `${input.dailyUpdatesSubmitted} update(s) over ${input.attendance.presentDays} day(s) present`,
            sources: [],
          }
        : none("No days present"),
    manager_review:
      input.managerRating !== null
        ? { score: round(input.managerRating), formula: "manager rating (0–100)", detail: "From the period's manager review", sources: [] }
        : none("Manager review not submitted yet"),
  };

  const configured = (Object.entries(weights) as [MetricKey, number][]).filter(([, w]) => w > 0);
  const totalWeight = sum(configured.map(([, w]) => w));
  const covered = configured.filter(([k]) => raw[k].score !== null);
  const coveredWeight = sum(covered.map(([, w]) => w));
  const coverage = totalWeight ? round((coveredWeight / totalWeight) * 100) : 0;

  const components: Component[] = configured.map(([key, weight]) => {
    const r = raw[key];
    return {
      key,
      label: METRIC_LABELS[key],
      weight,
      ...r,
      contribution: r.score === null || coveredWeight === 0 ? null : round((r.score * weight) / coveredWeight),
    };
  });

  const insufficientData = validation.length > 0 || coverage < minCoverage;
  const score = insufficientData ? null : round(sum(components.map((c) => c.contribution ?? 0)));

  const improvements = components
    .filter((c) => c.score !== null && c.score < 80)
    .sort((a, b) => (a.score! - 80) * a.weight - (b.score! - 80) * b.weight)
    .slice(0, 3)
    .map((c) => tip(c));
  for (const c of components)
    if (c.score === null) improvements.push(`${c.label}: ${c.detail.toLowerCase()} — this dimension isn't counted yet.`);

  return { score, category: categorise(score, opts.thresholds), coverage, components, insufficientData, improvements, validation };
}

function tip(c: Component): string {
  const s = `${c.label} is ${c.score}%.`;
  switch (c.key) {
    case "on_time_delivery":
      return `${s} Flag risks early and submit for review before the deadline.`;
    case "task_quality":
      return `${s} Ask your reviewer what moved your score down and self-check against it before submitting.`;
    case "task_completion":
      return `${s} Break large tasks into subtasks and close out pending items first.`;
    case "productivity":
      return `${s} Log actual hours accurately and agree realistic estimates with your manager.`;
    case "attendance":
      return `${s} Clock in within the grace period and keep full working hours.`;
    case "daily_updates":
      return `${s} Submit your daily update before you clock out.`;
    case "rework":
      return `${s} Clarify requirements up front to avoid tasks being sent back.`;
    case "manager_review":
      return `${s} Discuss the review comments with your manager and agree next-period goals.`;
  }
}

function none(detail: string) {
  return { score: null, formula: "—", detail, sources: [] as string[] };
}
function pct(a: number, b: number) {
  return b === 0 ? 0 : round((a / b) * 100);
}
function avg(xs: number[]) {
  return xs.length ? sum(xs) / xs.length : 0;
}
function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function round(n: number) {
  return Math.round(n * 100) / 100;
}
