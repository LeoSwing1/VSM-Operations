import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

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
  const { data } = await sb.from("payroll_entries").select("*, employee:employees!payroll_entries_employee_id_fkey(employee_code, full_name)").eq("run_id", runId);
  await sb.rpc("log_audit", { p_action: "payroll.exported", p_entity: "payroll_run", p_entity_id: runId, p_metadata: { rows: data?.length ?? 0 } });
  const head = ["Employee ID", "Name", "Payable days", "LOP days", "Base", "Allowances", "Incentive", "Attendance incentive", "Bonus", "Reimbursement", "Deductions", "Gross", "Net", "Payment status", "Reference"];
  const rows = (data ?? []).map((e: any) => [e.employee?.employee_code, e.employee?.full_name, e.payable_days, e.lop_days, e.base_amount, e.allowances_amount, e.incentive_amount,
    e.attendance_incentive_amount, e.bonus_amount, e.reimbursement_amount, e.deductions_amount, e.gross_amount, e.net_amount, e.payment_status, e.payment_reference ?? ""]);
  const csv = [head, ...rows].map((r) => r.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="payroll-${run.period_start}-${run.period_end}.csv"` } });
}
