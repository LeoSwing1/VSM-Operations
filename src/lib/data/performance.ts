import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computePerformance, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type TaskInput, type Weights } from "@/lib/engines/performance";
import { loadAttendance } from "./attendance";

export interface Policy {
  id: string; name: string; department_id: string | null; role: string | null;
  weights: Weights; min_coverage: number; category_thresholds: typeof DEFAULT_THRESHOLDS;
}

/** Most specific active policy wins: department+role → department → role → organisation default. */
export function pickPolicy(policies: Policy[], deptId: string | null, role: string): Policy | null {
  const rank = (p: Policy) =>
    (p.department_id && p.department_id !== deptId) || (p.role && p.role !== role) ? -1
      : (p.department_id ? 2 : 0) + (p.role ? 1 : 0);
  return [...policies].map((p) => [rank(p), p] as const).filter(([r]) => r >= 0).sort((a, b) => b[0] - a[0])[0]?.[1] ?? null;
}

export async function computeForEmployee(sb: SupabaseClient, employeeId: string, start: string, end: string, tz: string) {
  const { data: emp } = await sb.from("employees").select("id, department_id, role").eq("id", employeeId).maybeSingle();
  if (!emp) return null;
  const [{ data: policies }, { data: tasks }, { count: updates }, { data: reviews }, attendance] = await Promise.all([
    sb.from("performance_policies").select("id,name,department_id,role,weights,min_coverage,category_thresholds")
      .eq("is_active", true).lte("effective_from", end),
    sb.from("tasks").select("id,status,deadline,completed_at,submitted_at,quality_score,estimated_hours,actual_hours,reopen_count,created_at")
      .eq("assignee_id", employeeId)
      .or(`and(deadline.gte.${start}T00:00:00+05:30,deadline.lte.${end}T23:59:59+05:30),and(completed_at.gte.${start}T00:00:00+05:30,completed_at.lte.${end}T23:59:59+05:30)`),
    sb.from("daily_updates").select("id", { count: "exact", head: true }).eq("employee_id", employeeId).gte("work_date", start).lte("work_date", end),
    sb.from("manager_reviews").select("rating").eq("employee_id", employeeId).eq("period_start", start).eq("period_end", end),
    loadAttendance(sb, employeeId, start, end, tz),
  ]);
  const policy = pickPolicy((policies ?? []) as Policy[], emp.department_id, emp.role);
  const ratings = (reviews ?? []).map((r) => Number(r.rating));
  const result = computePerformance({
    periodStart: start, periodEnd: end,
    tasks: (tasks ?? []).map((t: any) => ({ ...t, quality_score: t.quality_score === null ? null : Number(t.quality_score),
      estimated_hours: t.estimated_hours === null ? null : Number(t.estimated_hours), actual_hours: t.actual_hours === null ? null : Number(t.actual_hours) })) as TaskInput[],
    attendance: attendance ?? { attendancePct: null, punctualityPct: null, presentDays: 0, workingDays: 0 },
    dailyUpdatesSubmitted: updates ?? 0,
    managerRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
  }, policy?.weights ?? DEFAULT_WEIGHTS, { minCoverage: policy?.min_coverage ?? 60, thresholds: policy?.category_thresholds ?? DEFAULT_THRESHOLDS });
  return { policy, result, attendance, tasks: tasks ?? [], updates: updates ?? 0 };
}
