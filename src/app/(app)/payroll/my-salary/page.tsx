import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { fmtDate, localDate } from "@/lib/engines/time";
import { nextSalaryDate, ordinal } from "@/lib/engines/salary-day";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap, inr } from "@/components/ui";

export const metadata = { title: "My salary" };

export default async function MySalary() {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  // RLS returns ONLY the caller's rows; the explicit filter is belt-and-braces.
  const [{ data: structs }, { data: slips }, { data: me }] = await Promise.all([
    sb
      .from("salary_structures")
      .select("id, effective_from, effective_to, pay_type, base_monthly, allowances, deductions, target_incentive, attendance_incentive")
      .eq("employee_id", ctx.employee_id)
      .order("effective_from", { ascending: false }),
    sb
      .from("payroll_entries")
      .select("id, run_id, gross_amount, net_amount, incentive_amount, payment_status, paid_on, created_at")
      .eq("employee_id", ctx.employee_id)
      .order("created_at", { ascending: false }),
    sb.from("employees").select("salary_day").eq("id", ctx.employee_id).maybeSingle(),
  ]);
  const payDay = (me?.salary_day as number | null) ?? null;
  await sb.rpc("log_salary_access", {
    p_entity: "employee",
    p_entity_id: ctx.employee_id,
    p_subject: ctx.employee_id,
    p_purpose: "self-service salary",
  });
  const cur = structs?.find((s) => !s.effective_to) ?? structs?.[0];
  const allowances = cur ? (cur.allowances as any[]).reduce((a, x) => a + Number(x.amount), 0) : 0;

  return (
    <>
      <PageHeader eyebrow="Private to you" title="My salary">
        {payDay && (
          <span className="btn pointer-events-none border border-line">
            Salary day: {ordinal(payDay)} · next {fmtDate(nextSalaryDate(payDay, localDate(new Date(), ctx.timezone)))}
          </span>
        )}
      </PageHeader>
      {!cur ? (
        <Empty title="No salary structure on file" hint="Contact HR if you think this is wrong." />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Monthly base" value={inr(cur.base_monthly)} hint={`Since ${fmtDate(cur.effective_from)}`} />
          <Stat label="Fixed allowances" value={inr(allowances)} />
          <Stat
            label="Target incentive"
            value={inr(cur.target_incentive)}
            hint={cur.pay_type === "FIXED" ? "Not applicable" : "Paid by approved performance score"}
            tone="volt"
          />
          <Stat label="Pay type" value={<span className="text-2xl">{cur.pay_type.replaceAll("_", " ").toLowerCase()}</span>} />
        </div>
      )}
      {cur && cur.pay_type !== "FIXED" && (
        <p className="mt-4 text-sm text-muted">
          Your incentive depends on your approved monthly performance score.{" "}
          <Link href="/analytics/my-performance" className="text-volt">
            See your score and how it&apos;s calculated →
          </Link>
        </p>
      )}
      <Card title="Payslips" className="mt-6">
        {!slips?.length ? (
          <Empty title="No payslips yet" hint="Payslips appear here once a payroll run is approved." />
        ) : (
          <TableWrap>
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Issued</th>
                  <th>Gross</th>
                  <th>Incentive</th>
                  <th>Net</th>
                  <th>Payment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDate(s.created_at.slice(0, 10))}</td>
                    <td className="tabular-nums">{inr(s.gross_amount)}</td>
                    <td className="tabular-nums">{inr(s.incentive_amount)}</td>
                    <td className="tabular-nums font-semibold">{inr(s.net_amount)}</td>
                    <td>
                      <Badge>{s.payment_status}</Badge>
                      {s.paid_on && <span className="ml-2 text-xs text-muted">{fmtDate(s.paid_on)}</span>}
                    </td>
                    <td>
                      <Link href={`/payroll/payslip/${s.id}`} className="text-sm hover:text-volt">
                        View / download →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {!!structs && structs.length > 1 && (
        <Card title="Salary history" className="mt-6">
          <ul className="divide-y divide-line text-sm">
            {structs.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <span>
                  {fmtDate(s.effective_from)} → {s.effective_to ? fmtDate(s.effective_to) : "current"}
                </span>
                <span className="tabular-nums">{inr(s.base_monthly)} base</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
