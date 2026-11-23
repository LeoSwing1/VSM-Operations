import { requirePerm, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { saveVendor, recordVendorPayment } from "../actions";
export const metadata = { title: "Vendors & payments" };
export default async function Vendors({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requirePerm("finance.view", "finance.manage", "finance.pay"),
    sb = await supabaseServer();
  const [{ data: vendors }, { data: payments }] = await Promise.all([
    sb.from("vendors").select("*").order("name"),
    sb.from("vendor_payments").select("*").order("paid_on", { ascending: false }).limit(100),
  ]);
  return (
    <>
      <PageHeader eyebrow="Finance · accounts payable" title="Vendors & payments">
        <a className="btn-ghost" href="/finance">
          Finance overview
        </a>
      </PageHeader>
      <Flash sp={sp} />
      {can(ctx, "finance.manage") && (
        <Card title="Add vendor" className="mb-6">
          <form action={saveVendor} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Vendor name">
              <input name="name" className="input" required minLength={2} />
            </Field>
            <Field label="Contact person">
              <input name="contact_name" className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="input" />
            </Field>
            <Field label="Phone">
              <input name="phone" className="input" />
            </Field>
            <Field label="GST / tax ID">
              <input name="tax_id" className="input" />
            </Field>
            <Field label="Payment terms">
              <input name="payment_terms" className="input" placeholder="Net 15 / due on receipt" />
            </Field>
            <Field label="Address" className="sm:col-span-2 xl:col-span-3">
              <textarea name="address" className="input min-h-16" />
            </Field>
            <div>
              <button className="btn-primary">Save vendor</button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Vendor directory" className="mb-6">
        {!vendors?.length ? (
          <Empty title="No vendors yet" hint="Add vendors to associate expenses and payment records." />
        ) : (
          <TableWrap>
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Contact</th>
                  <th>Tax ID</th>
                  <th>Terms</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.name}</td>
                    <td>{v.contact_name || v.email || "—"}</td>
                    <td>{v.tax_id || "—"}</td>
                    <td>{v.payment_terms || "—"}</td>
                    <td>
                      <Badge>{v.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {can(ctx, "finance.pay") && (
        <Card title="Record vendor payment" className="mb-6">
          <form action={recordVendorPayment} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Vendor">
              <select name="vendor_id" className="input" required>
                <option value="">Select vendor</option>
                {(vendors ?? [])
                  .filter((v) => v.status === "ACTIVE")
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Amount (INR)">
              <input name="amount" type="number" step="0.01" min="0.01" className="input" required />
            </Field>
            <Field label="Paid on">
              <input name="paid_on" type="date" className="input" defaultValue={localDate(new Date(), ctx.timezone)} required />
            </Field>
            <Field label="Payment method">
              <select name="method" className="input">
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Reference">
              <input name="reference" className="input" required />
            </Field>
            <Field label="Notes">
              <input name="notes" className="input" />
            </Field>
            <div>
              <button className="btn-primary">Record payment</button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Vendor payment ledger">
        {!payments?.length ? (
          <Empty title="No vendor payments" />
        ) : (
          <TableWrap>
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p: any) => (
                  <tr key={p.id}>
                    <td>{vendors?.find((v) => v.id === p.vendor_id)?.name ?? "Vendor"}</td>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>{p.method.replaceAll("_", " ")}</td>
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
