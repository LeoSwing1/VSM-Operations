import { requireContext, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { submitExpense, decideExpense, payExpense } from "../actions";
export const metadata = { title: "Expenses & reimbursements" };
export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requireContext(),
    sb = await supabaseServer();
  const [{ data: rows }, { data: projects }, { data: departments }, { data: vendors }] = await Promise.all([
    sb.from("finance_expenses").select("*").order("created_at", { ascending: false }).limit(150),
    sb.from("projects").select("id,name").order("name"),
    sb.from("departments").select("id,name").order("name"),
    sb.from("vendors").select("id,name").eq("status", "ACTIVE").order("name"),
  ]);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const canManagerReview = canAny(ctx, ["finance.approve_manager", "finance.approve_all"]),
    canFinanceReview = can(ctx, "finance.approve"),
    canPay = can(ctx, "finance.pay");
  return (
    <>
      <PageHeader eyebrow="Finance · claims workflow" title="Expenses & reimbursements">
        <a className="btn-ghost" href="/finance">
          Finance overview
        </a>
      </PageHeader>
      <Flash sp={sp} />
      <Card title="Submit expense or reimbursement" className="mb-6">
        <form action={submitExpense} encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Claim type">
            <select name="expense_type" className="input">
              <option value="REIMBURSEMENT">Employee reimbursement</option>
              <option value="COMPANY_EXPENSE">Company expense</option>
            </select>
          </Field>
          <Field label="Category">
            <select name="category" className="input" required>
              <option>Travel</option>
              <option>Meals</option>
              <option>Software</option>
              <option>Office supplies</option>
              <option>Internet & utilities</option>
              <option>Marketing</option>
              <option>Client meeting</option>
              <option>Other</option>
            </select>
          </Field>
          <Field label="Amount (INR)">
            <input className="input" name="amount" type="number" min="0.01" step="0.01" required />
          </Field>
          <Field label="Expense date">
            <input className="input" name="expense_date" type="date" defaultValue={localDate(new Date(), ctx.timezone)} required />
          </Field>
          <Field label="Project">
            <select className="input" name="project_id">
              <option value="">No project</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <select className="input" name="department_id">
              <option value="">No department</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor (optional)">
            <select className="input" name="vendor_id">
              <option value="">No vendor</option>
              {(vendors ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Receipt (PDF / image, max 10 MB)">
            <input className="input" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
          </Field>
          <Field label="Description" className="sm:col-span-2 xl:col-span-3">
            <textarea className="input min-h-20" name="description" minLength={3} maxLength={1000} required />
          </Field>
          <div>
            <button className="btn-primary">Submit for approval</button>
          </div>
        </form>
      </Card>
      <Card title="Expense register">
        {!rows?.length ? (
          <Empty title="No expenses yet" hint="Claims submitted by you or visible to your approval scope appear here." />
        ) : (
          <TableWrap>
            <table className="table min-w-[900px]">
              <thead>
                <tr>
                  <th>Reference / employee</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Project</th>
                  <th>Amount</th>
                  <th>Receipt</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e: any) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.expense_code}</strong>
                      <div className="text-xs text-muted">{e.employee_id === ctx.employee_id ? "You" : e.employee_id.slice(0, 8)}</div>
                    </td>
                    <td>{fmtDate(e.expense_date)}</td>
                    <td>{e.category}</td>
                    <td>{e.project_id ? (projectNames.get(e.project_id) ?? e.project_id.slice(0, 8)) : "—"}</td>
                    <td>{inr(e.amount)}</td>
                    <td>
                      {e.receipt_path ? (
                        <a className="text-volt underline" href={`/api/finance/receipt/${e.id}`}>
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge>{e.status}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {((canManagerReview && e.status === "SUBMITTED") || (canFinanceReview && e.status === "MANAGER_APPROVED")) && (
                          <form action={decideExpense} className="flex gap-1">
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="decision" value="APPROVE" />
                            <button className="btn-ghost text-xs">Approve</button>
                          </form>
                        )}
                        {((canManagerReview && e.status === "SUBMITTED") || (canFinanceReview && e.status === "MANAGER_APPROVED")) && (
                          <form action={decideExpense} className="flex gap-1">
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="decision" value="REJECT" />
                            <button className="btn-ghost text-xs">Reject</button>
                          </form>
                        )}
                        {canPay && e.status === "APPROVED" && (
                          <form action={payExpense} className="flex flex-wrap gap-1">
                            <input type="hidden" name="id" value={e.id} />
                            <input name="reference" placeholder="Payment ref" className="input w-28" required />
                            <select name="method" className="input w-32">
                              <option value="BANK_TRANSFER">Bank transfer</option>
                              <option value="UPI">UPI</option>
                              <option value="CASH">Cash</option>
                              <option value="CARD">Card</option>
                              <option value="CHEQUE">Cheque</option>
                              <option value="OTHER">Other</option>
                            </select>
                            <input type="hidden" name="paid_on" value={localDate(new Date(), ctx.timezone)} />
                            <button className="btn-primary text-xs">Mark paid</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-4 text-xs text-muted">
        Approval chain: employee submission → manager approval → finance approval → payment. The same person cannot approve both stages or
        approve their own claim. Receipt files are private and access follows the claim’s row-level permissions.
      </p>
    </>
  );
}
