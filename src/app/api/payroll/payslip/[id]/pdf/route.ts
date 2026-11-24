import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { payslipPdf } from "@/lib/pdf/payslip";
import { fmtDate } from "@/lib/engines/time";

export const dynamic = "force-dynamic";

/** Payslip PDF. Same rule as the payslip page: RLS returns an employee only their own released entry; payroll roles any. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: e } = await sb
    .from("payroll_entries")
    .select(
      "*, run:payroll_runs(period_start, period_end), employee:employees!payroll_entries_employee_id_fkey(full_name, employee_code, designation, joining_date, department:departments!department_id(name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [{ data: released }, { data: st }] = await Promise.all([
    sb.rpc("payroll_run_released", { p_run: e.run_id }),
    sb.from("employee_statutory").select("pan, uan, bank_account_no").eq("employee_id", e.employee_id).maybeSingle(),
  ]);
  await sb.rpc("log_salary_access", { p_entity: "payroll_entry", p_entity_id: id, p_subject: e.employee_id, p_purpose: "payslip_pdf" });
  type L = { label: string; amount: number; kind: string };
  const lines = (e.breakdown?.lines ?? []) as L[];
  const stat = (e.statutory ?? {}) as { lines?: { label: string; amount: number; employer?: boolean }[] };
  const statLines = stat.lines ?? [];
  const deductions = [...lines.filter((l) => l.kind === "DEDUCTION"), ...statLines.filter((l) => !l.employer)];
  const emp = e.employee as {
    full_name: string;
    employee_code: string;
    designation: string | null;
    joining_date: string | null;
    department: { name: string } | null;
  };
  const run = e.run as { period_start: string; period_end: string };
  const period = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: ctx.timezone }).format(
    new Date(`${run.period_start}T12:00:00Z`),
  );
  const mask = (pan?: string | null) => (pan ? `${pan.slice(0, 2)}xxxxx${pan.slice(-3)}` : null);
  const pdf = await payslipPdf({
    org: ctx.org_name,
    orgLine: "Meerut, Uttar Pradesh - GSTIN 09AAVFV8024A1ZW",
    period,
    issued: fmtDate(String(e.created_at).slice(0, 10)),
    released: !!released,
    employee: {
      name: emp.full_name,
      code: emp.employee_code,
      designation: emp.designation,
      department: emp.department?.name,
      joining: emp.joining_date ? fmtDate(emp.joining_date) : null,
      pan: mask(st?.pan),
      uan: st?.uan ?? null,
      bankLast4: st?.bank_account_no?.slice(-4) ?? null,
    },
    payableDays: `${e.payable_days} of ${e.period_days}${Number(e.lop_days) ? ` (LOP ${e.lop_days})` : ""}`,
    payment: `${e.payment_status}${e.paid_on ? ` on ${fmtDate(e.paid_on)}` : ""}`,
    earnings: lines.filter((l) => l.kind === "EARNING"),
    deductions,
    employer: statLines.filter((l) => l.employer),
    gross: Number(e.gross_amount),
    totalDeductions: deductions.reduce((a, l) => a + Number(l.amount), 0),
    reimbursement: Number(e.reimbursement_amount),
    net: Number(e.net_amount),
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="payslip-${emp.employee_code}-${run.period_start.slice(0, 7)}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
