import { NextRequest, NextResponse } from "next/server";
import { requirePerm, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { csvCell } from "@/lib/reports/csv";
import { localDate, zonedInstant } from "@/lib/engines/time";

function dateOr(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fallback;
}
export async function GET(request: NextRequest) {
  const ctx = await requirePerm("executive.view");
  const today = localDate(new Date(), ctx.timezone);
  const from = dateOr(request.nextUrl.searchParams.get("from"), `${today.slice(0, 7)}-01`);
  const to = dateOr(request.nextUrl.searchParams.get("to"), today);
  if (from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  const fromIso = zonedInstant(from, "00:00", ctx.timezone).toISOString();
  const toIso = zonedInstant(to, "23:59:59", ctx.timezone).toISOString();
  const sb = await supabaseServer();
  const rows: string[][] = [["Metric", "Value", "Period start", "Period end"]];
  const [employees, projects, tasks, receipts, expenses, invoices] = await Promise.all([
    can(ctx, "people.view_all")
      ? sb.from("employees").select("id", { count: "exact", head: true }).neq("status", "EXITED")
      : Promise.resolve({ count: null }),
    can(ctx, "projects.view_all") ? sb.from("projects").select("id,status").neq("status", "CANCELLED") : Promise.resolve({ data: null }),
    can(ctx, "tasks.view_all")
      ? sb.from("tasks").select("id,status").gte("created_at", fromIso).lte("created_at", toIso)
      : Promise.resolve({ data: null }),
    can(ctx, "finance.view")
      ? sb.from("invoice_payments").select("amount").gte("paid_on", from).lte("paid_on", to)
      : Promise.resolve({ data: null }),
    can(ctx, "finance.view")
      ? sb.from("finance_expenses").select("amount").eq("status", "PAID").gte("paid_on", from).lte("paid_on", to)
      : Promise.resolve({ data: null }),
    can(ctx, "finance.view")
      ? sb.from("client_invoices").select("total_amount").gte("issue_date", from).lte("issue_date", to).neq("status", "VOID")
      : Promise.resolve({ data: null }),
  ]);
  const add = (name: string, value: unknown) => rows.push([name, String(value ?? "Not authorised"), from, to]);
  add("Active people", employees.count);
  add("Active projects", projects.data?.filter((x) => x.status === "ACTIVE").length);
  add("Completed projects", projects.data?.filter((x) => x.status === "COMPLETED").length);
  add("Tasks created", tasks.data?.length);
  add("Tasks completed", tasks.data?.filter((x) => x.status === "COMPLETED").length);
  if (can(ctx, "finance.view")) {
    const receiptsTotal = (receipts.data ?? []).reduce((s, x) => s + Number(x.amount), 0);
    const spendTotal = (expenses.data ?? []).reduce((s, x) => s + Number(x.amount), 0);
    const invoiceTotal = (invoices.data ?? []).reduce((s, x) => s + Number(x.total_amount), 0);
    add("Client receipts (cash basis)", receiptsTotal.toFixed(2));
    add("Paid expenses", spendTotal.toFixed(2));
    add("Net cash movement (limited scope)", (receiptsTotal - spendTotal).toFixed(2));
    add("Invoices issued", invoiceTotal.toFixed(2));
  }
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${body}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vsm-ops-executive-${from}-${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
