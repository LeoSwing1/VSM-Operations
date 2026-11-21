import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { csvCell } from "@/lib/reports/csv";
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sb = await supabaseServer();
  const from = req.nextUrl.searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.nextUrl.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  const all = can(ctx, "time.view_all"), team = can(ctx, "time.view_team");
  let q = sb.from("task_time_entries").select("work_date,minutes,description,billable,status,employee:employees!task_time_entries_employee_id_fkey(full_name),task:tasks(title),project:projects(name)").gte("work_date", from).lte("work_date", to).order("work_date");
  if (!all && !team) q = q.eq("employee_id", ctx.employee_id);
  const { data, error } = await q.limit(5000);
  if (error) return NextResponse.json({ error: "report unavailable" }, { status: 500 });
  const rows = [["Date", "Employee", "Task", "Project", "Description", "Minutes", "Hours", "Billable", "Approval status"], ...(data ?? []).map((r: any) => [r.work_date, r.employee?.full_name, r.task?.title, r.project?.name, r.description, r.minutes, (r.minutes / 60).toFixed(2), r.billable ? "Yes" : "No", r.status])];
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse("\uFEFF" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="opdesk-timesheet-${from}-${to}.csv"`, "Cache-Control": "private, no-store" } });
}
