import Link from "next/link";
import { requirePerm, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap, inr, Flash } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";

export const metadata = {title:"Finance ERP"};
export default async function FinanceHome({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const sp=await searchParams; const ctx=await requirePerm("finance.view","finance.manage","finance.approve","finance.approve_manager","finance.approve_all","finance.pay"); const sb=await supabaseServer();
 const [{data:expenses},{data:invoices},{data:payments},{data:budgets}] = await Promise.all([
  sb.from("finance_expenses").select("id,amount,status,expense_type,expense_date,expense_code").order("created_at",{ascending:false}).limit(10000),
  sb.from("client_invoices").select("id,total_amount,status,due_date,invoice_number").order("issue_date",{ascending:false}).limit(10000),
  sb.from("invoice_payments").select("amount,paid_on").order("paid_on",{ascending:false}).limit(10000),
  sb.from("department_budgets").select("id,amount,period_start,period_end")
 ]);
 const approved=(expenses??[]).filter(x=>["APPROVED","PAID"].includes(x.status)).reduce((a,x)=>a+Number(x.amount),0);
 const pending=(expenses??[]).filter(x=>["SUBMITTED","MANAGER_APPROVED"].includes(x.status));
 const outstanding=(invoices??[]).filter(x=>!(["PAID","VOID","DRAFT"].includes(x.status))).reduce((a,x)=>a+Number(x.total_amount),0);
 const received=(payments??[]).reduce((a,x)=>a+Number(x.amount),0);
 const paths: [string,string,string,boolean][]=[
  ["Expenses & reimbursements","/finance/expenses","Submit, review, approve and pay claims",true],
  ["Client invoices","/finance/invoices","Issue invoices and record collections",canAny(ctx,["finance.view","finance.manage","finance.pay"])],
  ["Vendors & payments","/finance/vendors","Vendor records and payment ledger",canAny(ctx,["finance.view","finance.manage","finance.pay"])],
  ["Budgets","/finance/budgets","Department and project allocations",canAny(ctx,["finance.view","finance.manage"])],
  ["Bank reconciliation","/finance/reconciliation","Statement lines and matching",canAny(ctx,["finance.view","finance.manage"])],
 ];
 return <>
  <PageHeader eyebrow="Finance · controlled ledger" title="Finance ERP"><a className="btn-ghost" href="/finance/reports">Financial reports</a></PageHeader>
  <Flash sp={sp}/>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-6">
   <Stat label="Approved expenses" value={inr(approved)} hint="Approved and paid claims"/>
   <Stat label="Awaiting approval" value={pending.length} hint="Manager or finance decision" tone="ember" href="/finance/expenses"/>
   <Stat label="Invoice receivables" value={inr(outstanding)} hint="Issued, partial and overdue invoices"/>
   <Stat label="Payments received" value={inr(received)} hint="Recorded invoice receipts" tone="volt"/>
  </div>
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
   {paths.filter(([, , ,show])=>show).map(([title,href,desc])=><Link href={href} key={href} className="card p-5 transition hover:border-ink/30"><p className="font-display text-2xl">{title} <span className="text-volt">↗</span></p><p className="mt-2 text-sm text-muted">{desc}</p></Link>)}
  </div>
  <div className="grid gap-5 xl:grid-cols-2">
   <Card title="Recent expenses">{!expenses?.length?<Empty title="No expense claims" hint="Submitted expenses and reimbursements will appear here."/>:<TableWrap><table className="table min-w-[520px]"><thead><tr><th>Reference</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead><tbody>{expenses.slice(0,12).map(e=><tr key={e.id}><td className="font-medium">{e.expense_code}</td><td>{fmtDate(e.expense_date)}</td><td>{e.expense_type.replaceAll("_"," ")}</td><td>{inr(e.amount)}</td><td><Badge>{e.status}</Badge></td></tr>)}</tbody></table></TableWrap>}</Card>
   <Card title="Recent invoices">{!invoices?.length?<Empty title="No client invoices" hint="Create a draft invoice to start tracking receivables."/>:<TableWrap><table className="table min-w-[520px]"><thead><tr><th>Invoice</th><th>Due</th><th>Total</th><th>Status</th></tr></thead><tbody>{invoices.slice(0,12).map(i=><tr key={i.id}><td className="font-medium">{i.invoice_number}</td><td>{fmtDate(i.due_date)}</td><td>{inr(i.total_amount)}</td><td><Badge>{i.status}</Badge></td></tr>)}</tbody></table></TableWrap>}</Card>
  </div>
  <p className="mt-5 text-xs text-muted">Budget allocations currently configured: {budgets?.length ?? 0}. Financial totals are derived from database records visible to your account; pending items are excluded from approved expenditure.</p>
 </>;
}
