import { NextResponse, type NextRequest } from "next/server";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { genericBankCsv, validAccount, validIfsc, type BankRow } from "@/lib/payroll/bank-file";

export const dynamic = "force-dynamic";

/** Bulk bank-transfer file for an APPROVED/PROCESSED run. Only UNPAID entries with complete bank details. Never marks anything paid. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("payroll.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: run } = await sb.from("payroll_runs").select("id, status, period_start").eq("id", id).maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["APPROVED", "PROCESSED"].includes(run.status))
    return NextResponse.json({ error: "The run must be approved before a bank file can be made." }, { status: 409 });
  const [{ data: entries }, { data: banks }] = await Promise.all([
    sb
      .from("payroll_entries")
      .select(
        "id, employee_id, net_amount, payment_status, employee:employees!payroll_entries_employee_id_fkey(full_name, employee_code, official_email)",
      )
      .eq("run_id", id),
    sb.from("employee_statutory").select("employee_id, bank_account_holder, bank_account_no, bank_ifsc"),
  ]);
  const bankOf = new Map((banks ?? []).map((b) => [b.employee_id, b]));
  const month = run.period_start.slice(0, 7);
  const rows: BankRow[] = [],
    skipped: string[] = [];
  for (const e of entries ?? []) {
    const emp = e.employee as unknown as { full_name: string; employee_code: string; official_email: string };
    if (e.payment_status === "PAID" || Number(e.net_amount) <= 0) continue;
    if (e.employee_id === ctx.employee_id) {
      skipped.push(`${emp.employee_code} (your own salary — another payroll admin must pay it)`);
      continue;
    }
    const b = bankOf.get(e.employee_id);
    if (!b?.bank_account_no || !b.bank_ifsc || !validAccount(b.bank_account_no) || !validIfsc(b.bank_ifsc)) {
      skipped.push(`${emp.employee_code} ${emp.full_name}`);
      continue;
    }
    rows.push({
      name: b.bank_account_holder || emp.full_name,
      account: b.bank_account_no,
      ifsc: b.bank_ifsc,
      amount: Number(e.net_amount),
      email: emp.official_email,
      code: emp.employee_code,
      narration: `VSM SALARY ${month}`,
    });
  }
  await sb.rpc("log_audit", {
    p_action: "payroll.bank_file_exported",
    p_entity: "payroll_run",
    p_entity_id: id,
    p_metadata: { rows: rows.length, skipped: skipped.length },
  });
  await sb.rpc("log_salary_access", { p_entity: "payroll_run", p_entity_id: id, p_subject: null, p_purpose: "bank_file" });
  return new NextResponse(genericBankCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vsm-salary-${month}-bank-transfer.csv"`,
      "cache-control": "private, no-store",
      "x-vsm-skipped": encodeURIComponent(skipped.join("; ").slice(0, 1500)),
    },
  });
}
