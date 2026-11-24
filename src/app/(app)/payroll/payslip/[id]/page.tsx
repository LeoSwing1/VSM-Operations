import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { inr } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { PrintButton } from "./print-button";

export const metadata = { title: "Payslip" };

export default async function Payslip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const sb = await supabaseServer();
  // RLS: an employee only ever gets their own released entry; payroll roles get any. Others: not found.
  const { data: e } = await sb
    .from("payroll_entries")
    .select(
      "*, employee:employees!payroll_entries_employee_id_fkey(full_name, employee_code, designation, joining_date, department:departments!department_id(name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();
  const { data: run } = await sb.rpc("payroll_run_released", { p_run: e.run_id });
  await sb.rpc("log_salary_access", { p_entity: "payroll_entry", p_entity_id: id, p_subject: e.employee_id, p_purpose: "payslip" });
  const lines = (e.breakdown?.lines ?? []) as { label: string; amount: number; kind: string; note?: string }[];
  const earnings = lines.filter((l) => l.kind === "EARNING");
  const stat = (e.statutory ?? {}) as { lines?: { label: string; amount: number; employer?: boolean; note?: string }[] };
  const deductions = [
    ...lines.filter((l) => l.kind === "DEDUCTION"),
    ...(stat.lines ?? []).filter((l) => !l.employer).map((l) => ({ ...l, kind: "DEDUCTION" })),
  ];
  const employerLines = (stat.lines ?? []).filter((l) => l.employer);

  return (
    <article className="mx-auto max-w-3xl">
      <div className="no-print mb-6 flex justify-between">
        <a href="/payroll/my-salary" className="text-sm text-muted hover:text-ink">
          ← Back
        </a>
        <span className="flex gap-2">
          <a href={`/api/payroll/payslip/${id}/pdf`} className="btn-ghost">
            Download PDF
          </a>
          <PrintButton />
        </span>
      </div>
      <div className="card p-8">
        <header className="flex flex-wrap justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="display text-4xl">
              VSM<span className="text-volt">.</span> Growth
            </p>
            <p className="text-xs text-muted">{ctx.org_name} · Meerut, Uttar Pradesh · GSTIN 09AAVFV8024A1ZW</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Payslip</p>
            <p className="text-sm">Issued {fmtDate(e.created_at.slice(0, 10))}</p>
            {!run && <p className="text-xs text-ember">Not yet released</p>}
          </div>
        </header>
        <dl className="grid gap-3 border-b border-line py-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Employee</dt>
            <dd>{e.employee?.full_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Employee ID</dt>
            <dd className="font-mono">{e.employee?.employee_code}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Designation</dt>
            <dd>{e.employee?.designation ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Department</dt>
            <dd>{e.employee?.department?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Payable days</dt>
            <dd>
              {e.payable_days} of {e.period_days}
              {Number(e.lop_days) ? ` (LOP ${e.lop_days})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Payment</dt>
            <dd>
              {e.payment_status}
              {e.paid_on ? ` · ${fmtDate(e.paid_on)}` : ""}
            </dd>
          </div>
        </dl>
        <div className="grid gap-8 py-6 sm:grid-cols-2">
          <section>
            <h2 className="eyebrow mb-2">Earnings</h2>
            <table className="table">
              <tbody>
                {earnings.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.label}
                      <p className="text-[10px] text-muted">{l.note}</p>
                    </td>
                    <td className="text-right tabular-nums">{inr(l.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-semibold">Gross</td>
                  <td className="text-right font-semibold tabular-nums">{inr(e.gross_amount)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="eyebrow mb-2">Deductions</h2>
            <table className="table">
              <tbody>
                {deductions.length ? (
                  deductions.map((l, i) => (
                    <tr key={i}>
                      <td>{l.label}</td>
                      <td className="text-right tabular-nums">{inr(l.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-muted">None</td>
                    <td />
                  </tr>
                )}
                {Number(e.reimbursement_amount) > 0 && (
                  <tr>
                    <td>Reimbursements (added)</td>
                    <td className="text-right tabular-nums">{inr(e.reimbursement_amount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-6">
          <div className="max-w-sm text-[11px] text-muted">
            {!!employerLines.length && (
              <p className="mb-2">
                Employer contributions (not deducted): {employerLines.map((l) => `${l.label} ${inr(l.amount)}`).join(" · ")}
              </p>
            )}
            <p>Computer-generated payslip; queries to HR.</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Net payable</p>
            <p className="display text-5xl tabular-nums">{inr(e.net_amount)}</p>
          </div>
        </footer>
      </div>
    </article>
  );
}
