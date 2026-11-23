import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { reportResponse } from "@/lib/reports/export";
export async function GET(req: Request) {
  await requirePerm("finance.export");
  const url = new URL(req.url);
  const from = url.searchParams.get("from"),
    to = url.searchParams.get("to");
  const sb = await supabaseServer();
  let e = sb
    .from("finance_expenses")
    .select("expense_code,category,amount,currency,expense_date,status,payment_reference")
    .in("status", ["APPROVED", "PAID"])
    .order("expense_date", { ascending: false })
    .limit(10000);
  let i = sb.from("invoice_payments").select("amount,paid_on,reference").order("paid_on", { ascending: false }).limit(10000);
  let v = sb.from("vendor_payments").select("amount,paid_on,reference").order("paid_on", { ascending: false }).limit(10000);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    e = e.gte("expense_date", from);
    i = i.gte("paid_on", from);
    v = v.gte("paid_on", from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    e = e.lte("expense_date", to);
    i = i.lte("paid_on", to);
    v = v.lte("paid_on", to);
  }
  const [er, ir, vr] = await Promise.all([e, i, v]);
  if (er.error || ir.error || vr.error) return NextResponse.json({ error: "Could not export finance report." }, { status: 500 });
  const rows = [
    ...(er.data ?? []).map((x) => [
      "EXPENDITURE",
      x.expense_date,
      x.expense_code,
      x.category,
      Number(x.amount),
      x.currency,
      x.status,
      x.payment_reference,
    ]),
    ...(ir.data ?? []).map((x) => ["CLIENT_RECEIPT", x.paid_on, x.reference, "Invoice payment", x.amount, "INR", "RECORDED", x.reference]),
    ...(vr.data ?? []).map((x) => ["VENDOR_PAYMENT", x.paid_on, x.reference, "Vendor payment", x.amount, "INR", "RECORDED", x.reference]),
  ];
  rows.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
  const body = [["transaction_type", "date", "reference", "description", "amount", "currency", "status", "payment_reference"], ...rows];
  const format = url.searchParams.get("format") ?? "csv";
  await sb.rpc("log_audit", {
    p_action: "finance.report_exported",
    p_entity: "finance_ledger",
    p_entity_id: format,
    p_metadata: { rows: rows.length, from, to, format },
  });
  return reportResponse(body, "vsm-ops-finance-ledger", format);
}
