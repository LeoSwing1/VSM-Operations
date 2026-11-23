import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { reportResponse } from "@/lib/reports/export";

/** Restricted payroll export: payroll.export only, every export audited. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!can(ctx, "payroll.export")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const runId = req.nextUrl.searchParams.get("run") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const sb = await supabaseServer();
  const { data: run } = await sb.from("payroll_runs").select("period_start, period_end, status").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data } = await sb
    .from("payroll_entries")
    .select("*, employee:employees!payroll_entries_employee_id_fkey(employee_code, full_name)")
    .eq("run_id", runId);
  await sb.rpc("log_audit", {
    p_action: "payroll.exported",
    p_entity: "payroll_run",
    p_entity_id: runId,
    p_metadata: { rows: data?.length ?? 0, format: req.nextUrl.searchParams.get("format") ?? "csv" },
  });
  const head = [
    "Employee ID",
    "Name",
    "Payable days",
    "LOP days",
    "Base",
    "Allowances",
    "Incentive",
    "Attendance incentive",
    "Bonus",
    "Reimbursement",
    "Deductions",
    "Gross",
    "Net",
    "Payment status",
    "Reference",
  ];
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows = (data ?? []).map((e: any) => [
    e.employee?.employee_code,
    e.employee?.full_name,
    n(e.payable_days),
    n(e.lop_days),
    n(e.base_amount),
    n(e.allowances_amount),
    n(e.incentive_amount),
    n(e.attendance_incentive_amount),
    n(e.bonus_amount),
    n(e.reimbursement_amount),
    n(e.deductions_amount),
    n(e.gross_amount),
    n(e.net_amount),
    e.payment_status,
    e.payment_reference ?? "",
  ]);
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  return reportResponse([head, ...rows], `payroll-${run.period_start}-${run.period_end}`, format);
}
