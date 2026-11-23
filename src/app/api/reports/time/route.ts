import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { reportResponse } from "@/lib/reports/export";
import { localDate } from "@/lib/engines/time";
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sb = await supabaseServer();
  const from = req.nextUrl.searchParams.get("from") ?? localDate(new Date(Date.now() - 30 * 86400000), ctx.timezone);
  const to = req.nextUrl.searchParams.get("to") ?? localDate(new Date(), ctx.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  const all = can(ctx, "time.view_all"),
    team = can(ctx, "time.view_team");
  let q = sb
    .from("task_time_entries")
    .select(
      "work_date,minutes,description,billable,status,employee:employees!task_time_entries_employee_id_fkey(full_name),task:tasks(title),project:projects(name)",
    )
    .gte("work_date", from)
    .lte("work_date", to)
    .or("started_at.is.null,ended_at.not.is.null")
    .order("work_date");
  if (!all && !team) q = q.eq("employee_id", ctx.employee_id);
  const { data, error } = await q.limit(5000);
  if (error) return NextResponse.json({ error: "report unavailable" }, { status: 500 });
  const rows = [
    ["Date", "Employee", "Task", "Project", "Description", "Minutes", "Hours", "Billable", "Approval status"],
    ...(data ?? []).map((r: any) => [
      r.work_date,
      r.employee?.full_name,
      r.task?.title,
      r.project?.name,
      r.description,
      r.minutes,
      Number((r.minutes / 60).toFixed(2)),
      r.billable ? "Yes" : "No",
      r.status,
    ]),
  ];
  await sb.rpc("log_audit", {
    p_action: "time.report_exported",
    p_entity: "task_time_entries",
    p_entity_id: `${from}:${to}`,
    p_metadata: { rows: (data ?? []).length, format: req.nextUrl.searchParams.get("format") ?? "csv" },
  });
  return reportResponse(rows, `vsm-ops-timesheet-${from}-${to}`, req.nextUrl.searchParams.get("format") ?? "csv");
}
