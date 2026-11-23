import { requirePerm, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { createInvoice, issueInvoice, recordInvoicePayment } from "../actions";
export const metadata = { title: "Client invoices" };
export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requirePerm("finance.view", "finance.manage", "finance.pay"),
    sb = await supabaseServer();
  const [{ data: invoices }, { data: clients }, { data: projects }, { data: payments }] = await Promise.all([
    sb.from("finance_invoice_balances").select("*").order("issue_date", { ascending: false }).limit(150),
    sb.from("clients").select("id,name").order("name"),
    sb.from("projects").select("id,name").order("name"),
    sb.from("invoice_payments").select("invoice_id,amount,paid_on,reference").order("paid_on", { ascending: false }).limit(200),
  ]);
  const clientMap = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader eyebrow="Finance · accounts receivable" title="Client invoices">
        <a className="btn-ghost" href="/finance">
          Finance overview
        </a>
      </PageHeader>
      <Flash sp={sp} />
      {can(ctx, "finance.manage") && (
        <Card title="Create invoice draft" className="mb-6">
          <form action={createInvoice} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Client">
              <select name="client_id" className="input" required>
                <option value="">Select client</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project (optional)">
              <select name="project_id" className="input">
                <option value="">No project</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invoice number">
              <input name="invoice_number" className="input" placeholder="VSM-INV-2026-001" required />
            </Field>
            <Field label="Issue date">
              <input name="issue_date" type="date" className="input" defaultValue={localDate(new Date(), ctx.timezone)} required />
            </Field>
            <Field label="Due date">
              <input name="due_date" type="date" className="input" required />
            </Field>
            <Field label="Line description">
              <input name="description" className="input" placeholder="Digital marketing services" required />
            </Field>
            <Field label="Quantity">
              <input name="quantity" type="number" step="0.001" min="0.001" defaultValue="1" className="input" required />
            </Field>
            <Field label="Unit price (INR)">
              <input name="unit_price" type="number" step="0.01" min="0" className="input" required />
            </Field>
            <Field label="Tax amount (INR)">
              <input name="tax_amount" type="number" step="0.01" min="0" defaultValue="0" className="input" />
            </Field>
            <Field label="Notes" className="sm:col-span-2 xl:col-span-3">
              <textarea name="notes" className="input min-h-16" />
            </Field>
            <div>
              <button className="btn-primary">Save draft invoice</button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Receivables register">
        {!invoices?.length ? (
          <Empty title="No invoices" hint="Create a draft invoice once your client and service details are ready." />
        ) : (
          <TableWrap>
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Issue / due</th>
                  <th>Total</th>
                  <th>Received</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i: any) => (
                  <tr key={i.id}>
                    <td className="font-semibold">{i.invoice_number}</td>
                    <td>{clientMap.get(i.client_id) ?? "Client"}</td>
                    <td>
                      {fmtDate(i.issue_date)}
                      <div className="text-xs text-muted">Due {fmtDate(i.due_date)}</div>
                    </td>
                    <td>{inr(i.total_amount)}</td>
                    <td>{inr(i.paid_amount)}</td>
                    <td>{inr(i.outstanding_amount)}</td>
                    <td>
                      <Badge>{i.status}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {can(ctx, "finance.manage") && i.status === "DRAFT" && (
                          <form action={issueInvoice}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="btn-ghost text-xs">Issue</button>
                          </form>
                        )}
                        {canAny(ctx, ["finance.pay", "finance.manage"]) && ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status) && (
                          <form action={recordInvoicePayment} className="flex flex-wrap gap-1">
                            <input type="hidden" name="invoice_id" value={i.id} />
                            <input
                              className="input w-24"
                              name="amount"
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={i.outstanding_amount}
                              placeholder="Amount"
                              required
                            />
                            <input className="input w-28" name="reference" placeholder="Reference" required />
                            <input type="hidden" name="paid_on" value={localDate(new Date(), ctx.timezone)} />
                            <select name="method" className="input w-32">
                              <option value="BANK_TRANSFER">Bank transfer</option>
                              <option value="UPI">UPI</option>
                              <option value="CASH">Cash</option>
                              <option value="CARD">Card</option>
                              <option value="CHEQUE">Cheque</option>
                              <option value="OTHER">Other</option>
                            </select>
                            <button className="btn-primary text-xs">Record receipt</button>
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
      <Card title="Recent invoice payments" className="mt-5">
        {!payments?.length ? (
          <Empty title="No receipts recorded" />
        ) : (
          <TableWrap>
            <table className="table min-w-[500px]">
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 20).map((p: any) => (
                  <tr key={`${p.invoice_id}-${p.reference}`}>
                    <td>{p.invoice_id.slice(0, 8)}</td>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>{p.reference}</td>
                    <td>{inr(p.amount)}</td>
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
