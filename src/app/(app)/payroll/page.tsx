import Link from "next/link";
import { requirePerm, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate, localDate, monthBounds, shiftMonth } from "@/lib/engines/time";
import { createRun } from "./actions";

export const metadata = { title: "Payroll" };

export default async function Payroll({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("payroll.view_all", "payroll.approve");
  const sb = await supabaseServer();
  const { data: runs } = await sb
    .from("payroll_runs")
    .select("id, period_start, period_end, status, created_at, entries:payroll_entries(net_amount)")
    .order("period_start", { ascending: false })
    .limit(36);
  await sb.rpc("log_salary_access", { p_entity: "payroll_runs", p_entity_id: "list", p_subject: null, p_purpose: "payroll overview" });
  const last = monthBounds(shiftMonth(localDate(new Date(), ctx.timezone), -1));
  return (
    <>
      <PageHeader eyebrow="Confidential · every view is logged" title="Payroll">
        {can(ctx, "payroll.manage") && (
          <a href="/payroll/statutory" className="btn-ghost">
            Statutory & bank
          </a>
        )}
        {can(ctx, "salary.manage") && (
          <Link href="/payroll/structures" className="btn-ghost">
            Salary structures
          </Link>
        )}
      </PageHeader>
      <Flash sp={sp} />
      {can(ctx, "payroll.manage") && (
        <Card title="Start a payroll run" className="mb-6">
          <form action={createRun} className="flex flex-wrap items-end gap-3">
            <Field label="Period start">
              <input type="date" name="start" defaultValue={last.start} className="input" required />
            </Field>
            <Field label="Period end">
              <input type="date" name="end" defaultValue={last.end} className="input" required />
            </Field>
            <button className="btn-primary">Create draft run</button>
          </form>
          <p className="mt-3 text-xs text-muted">
            Workflow: DRAFT → REVIEW → APPROVED (by someone other than the preparer) → PROCESSED → PAID (only once every entry has a payment
            reference).
          </p>
        </Card>
      )}
      <Card>
        {!runs?.length ? (
          <Empty title="No payroll runs yet" />
        ) : (
          <TableWrap>
            <table className="table min-w-[600px]">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Employees</th>
                  <th>Net payable</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    </td>
                    <td>
                      <Badge>{r.status}</Badge>
                    </td>
                    <td className="tabular-nums">{r.entries.length}</td>
                    <td className="tabular-nums">{inr(r.entries.reduce((a: number, e: any) => a + Number(e.net_amount), 0))}</td>
                    <td>
                      <Link href={`/payroll/runs/${r.id}`} className="text-sm hover:text-volt">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
