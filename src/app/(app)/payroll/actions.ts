"use server";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";
import { loadAttendance } from "@/lib/data/attendance";
import { calculatePayroll, validateSlabs, type Adjustment, type IncentivePolicy, type Money, type SalaryStructure, type Snapshot } from "@/lib/engines/payroll";

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createRun(fd: FormData) {
  const ctx = await requirePerm("payroll.manage");
  const start = Date_.safeParse(str(fd, "start")), end = Date_.safeParse(str(fd, "end"));
  if (!start.success || !end.success || end.data < start.data) flash("/payroll", "err", "Choose a valid period.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("payroll_runs").insert({ org_id: ctx.org_id, period_start: start.data, period_end: end.data, created_by: ctx.employee_id }).select("id").single();
  if (error) flash("/payroll", "err", dbMessage(error, "A run for this period already exists."));
  flash(`/payroll/runs/${data.id}`, "ok", "Draft run created. Calculate entries next.");
}

/** Steps 2–7 of the payroll workflow: eligible employees → structures → approved snapshots → engine → entries. */
export async function calculateRun(fd: FormData) {
  const ctx = await requirePerm("payroll.manage");
  const runId = z.string().uuid().parse(str(fd, "run_id"));
  const back = `/payroll/runs/${runId}`;
  const sb = await supabaseServer();
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) flash("/payroll", "err", "Run not found.");
  if (run.status !== "DRAFT") flash(back, "err", "Only draft runs can be recalculated.");

  const [{ data: emps }, { data: structures }, { data: policies }, { data: snaps }, { data: adjs }] = await Promise.all([
    sb.from("employees").select("id, full_name, joining_date, exit_date, status").lte("joining_date", run.period_end),
    sb.from("salary_structures").select("*").lte("effective_from", run.period_end).or(`effective_to.is.null,effective_to.gte.${run.period_start}`),
    sb.from("incentive_policies").select("id, slabs, cap_amount, prorate").eq("is_active", true),
    sb.from("performance_snapshots").select("id, employee_id, status, final_score").eq("period_start", run.period_start).eq("period_end", run.period_end).eq("status", "APPROVED"),
    sb.from("payroll_adjustments").select("employee_id, kind, label, amount, reason").eq("run_id", runId),
  ]);

  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const e of emps ?? []) {
    if (e.exit_date && e.exit_date < run.period_start) continue;
    if (e.id === ctx.employee_id) { skipped.push(`${e.full_name} (your own entry must be prepared by another payroll admin)`); continue; }
    // Latest structure effective within the period (mid-period revisions: the one in force at period end).
    const s = (structures ?? []).filter((x) => x.employee_id === e.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (!s) { skipped.push(`${e.full_name} (no salary structure)`); continue; }
    const att = await loadAttendance(sb, e.id, run.period_start, run.period_end, ctx.timezone);
    const policy = (policies ?? []).find((p) => p.id === s.incentive_policy_id) ?? null;
    const snap = (snaps ?? []).find((x) => x.employee_id === e.id) ?? null;
    const r = calculatePayroll({
      periodStart: run.period_start, periodEnd: run.period_end, joiningDate: e.joining_date, exitDate: e.exit_date,
      structure: { ...s, base_monthly: Number(s.base_monthly), target_incentive: Number(s.target_incentive), attendance_incentive: Number(s.attendance_incentive),
        allowances: (s.allowances as Money[]).map((m) => ({ ...m, amount: Number(m.amount) })), deductions: (s.deductions as Money[]).map((m) => ({ ...m, amount: Number(m.amount) })) } as SalaryStructure,
      policy: policy ? { ...policy, cap_amount: policy.cap_amount === null ? null : Number(policy.cap_amount) } as IncentivePolicy : null,
      snapshot: snap ? { ...snap, final_score: snap.final_score === null ? null : Number(snap.final_score) } as Snapshot : null,
      lopDays: att?.lopDays ?? 0,
      attendanceIncentiveEligible: (att?.lateArrivals ?? 1) === 0 && (att?.missingClockOuts ?? 1) === 0,
      adjustments: (adjs ?? []).filter((a) => a.employee_id === e.id).map((a) => ({ ...a, amount: Number(a.amount) })) as Adjustment[],
    });
    rows.push({
      org_id: ctx.org_id, run_id: runId, employee_id: e.id, structure_id: s.id, snapshot_id: snap?.id ?? null,
      period_days: r.periodDays, employed_days: r.employedDays, lop_days: r.lopDays, payable_days: r.payableDays,
      base_amount: r.base, allowances_amount: r.allowances, incentive_amount: r.incentive, attendance_incentive_amount: r.attendanceIncentive,
      bonus_amount: r.bonus, reimbursement_amount: r.reimbursement, deductions_amount: r.deductions, gross_amount: r.gross, net_amount: r.net,
      breakdown: { lines: r.lines, warnings: r.warnings, attendance: att ? { workingDays: att.workingDays, presentDays: att.presentDays, lopDays: att.lopDays, lateArrivals: att.lateArrivals } : null },
    });
  }
  // Replace the draft's entries atomically enough for a draft: delete then insert.
  const del = await sb.from("payroll_entries").delete().eq("run_id", runId);
  if (del.error) flash(back, "err", dbMessage(del.error));
  if (rows.length) {
    const { error } = await sb.from("payroll_entries").insert(rows);
    if (error) flash(back, "err", dbMessage(error));
  }
  await sb.rpc("log_audit", { p_action: "payroll.calculated", p_entity: "payroll_run", p_entity_id: runId, p_metadata: { entries: rows.length, skipped } });
  flash(back, "ok", `Calculated ${rows.length} entr${rows.length === 1 ? "y" : "ies"}.${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`);
}

export async function addAdjustment(fd: FormData) {
  const ctx = await requirePerm("payroll.manage");
  const runId = str(fd, "run_id"), back = `/payroll/runs/${runId}`;
  const amount = num(fd, "amount");
  const kind = z.enum(["BONUS", "REIMBURSEMENT", "DEDUCTION"]).safeParse(str(fd, "kind"));
  if (!kind.success || !amount || amount <= 0 || str(fd, "reason").length < 5) flash(back, "err", "Kind, positive amount and a reason (5+ chars) are required.");
  const sb = await supabaseServer();
  const { error } = await sb.from("payroll_adjustments").insert({ org_id: ctx.org_id, run_id: runId, employee_id: str(fd, "employee_id"), kind: kind.data,
    label: str(fd, "label") || kind.data.toLowerCase(), amount, reason: str(fd, "reason"), created_by: ctx.employee_id });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Adjustment added. Recalculate to apply it.");
}

export async function transitionRun(fd: FormData) {
  await requirePerm("payroll.manage", "payroll.approve", "payroll.pay");
  const runId = str(fd, "run_id"), back = `/payroll/runs/${runId}`;
  const to = z.enum(["REVIEW", "DRAFT", "APPROVED", "REJECTED", "PROCESSED", "CANCELLED"]).safeParse(str(fd, "to"));
  if (!to.success) flash(back, "err", "Invalid transition.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("payroll_transition", { p_run: runId, p_to: to.data, p_note: optStr(fd, "note") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", `Run moved to ${to.data}.`);
}

export async function markPaid(fd: FormData) {
  await requirePerm("payroll.pay");
  const runId = str(fd, "run_id"), back = `/payroll/runs/${runId}`;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("mark_entry_paid", { p_entry: str(fd, "entry_id"), p_reference: str(fd, "reference"), p_method: str(fd, "method"), p_paid_on: str(fd, "paid_on") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Payment recorded.");
}

const parseLines = (raw: string): Money[] => raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^(.+?)[:=]\s*([\d,.]+)$/);
  if (!m) throw new Error(`Couldn't read "${l}" — use "Name: amount"`);
  return { name: m[1]!.trim(), amount: Number(m[2]!.replace(/,/g, "")) };
});

export async function saveStructure(fd: FormData) {
  const ctx = await requirePerm("salary.manage");
  const back = "/payroll/structures";
  const employeeId = str(fd, "employee_id"), from = str(fd, "effective_from");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) flash(back, "err", "Effective date is required.");
  let allowances: Money[], deductions: Money[];
  try { allowances = parseLines(str(fd, "allowances")); deductions = parseLines(str(fd, "deductions")); }
  catch (e) { flash(back, "err", (e as Error).message); }
  const payType = z.enum(["FIXED", "FIXED_PLUS_VARIABLE", "INCENTIVE_ONLY"]).parse(str(fd, "pay_type") || "FIXED");
  const sb = await supabaseServer();
  // Close the currently open structure the day before the new one starts (history is kept).
  const prevEnd = new Date(Date.parse(`${from}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const { data: open } = await sb.from("salary_structures").select("id, effective_from").eq("employee_id", employeeId).is("effective_to", null).maybeSingle();
  if (open) {
    if (open.effective_from >= from) flash(back, "err", "New structure must start after the current one.");
    const { error } = await sb.from("salary_structures").update({ effective_to: prevEnd }).eq("id", open.id);
    if (error) flash(back, "err", dbMessage(error));
  }
  const { error } = await sb.from("salary_structures").insert({
    org_id: ctx.org_id, employee_id: employeeId, effective_from: from, pay_type: payType,
    base_monthly: payType === "INCENTIVE_ONLY" ? 0 : num(fd, "base_monthly") ?? 0, allowances, deductions,
    target_incentive: payType === "FIXED" ? 0 : num(fd, "target_incentive") ?? 0, incentive_policy_id: optStr(fd, "incentive_policy_id"),
    attendance_incentive: num(fd, "attendance_incentive") ?? 0, notes: optStr(fd, "notes"), created_by: ctx.employee_id,
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Salary structure saved (previous version kept in history).");
}

export async function saveIncentivePolicy(fd: FormData) {
  const ctx = await requirePerm("salary.manage");
  const back = "/payroll/structures";
  const slabs: { min: number; pct: number }[] = [];
  for (let i = 0; i < 6; i++) { const min = num(fd, `min_${i}`), pct = num(fd, `pct_${i}`); if (min !== null && pct !== null) slabs.push({ min, pct }); }
  const errs = validateSlabs(slabs);
  if (errs.length) flash(back, "err", errs.join(". "));
  const sb = await supabaseServer();
  const id = optStr(fd, "id");
  const row = { org_id: ctx.org_id, name: str(fd, "name") || "Incentive policy", slabs, cap_amount: num(fd, "cap_amount"), prorate: fd.get("prorate") === "on" };
  const { error } = id ? await sb.from("incentive_policies").update(row).eq("id", id) : await sb.from("incentive_policies").insert(row);
  if (error) flash(back, "err", dbMessage(error));
  await sb.rpc("log_audit", { p_action: "payroll.incentive_policy_saved", p_entity: "incentive_policy", p_entity_id: id ?? "new", p_metadata: { slabs } });
  flash(back, "ok", "Incentive policy saved.");
}
