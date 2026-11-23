import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { reportResponse } from "@/lib/reports/export";
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!can(ctx, "quality.view_all") && !can(ctx, "quality.view_team") && !can(ctx, "quality.review"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const from = req.nextUrl.searchParams.get("from"),
    to = req.nextUrl.searchParams.get("to");
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to))
    return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  const sb = await supabaseServer();
  let q = sb
    .from("quality_assessments")
    .select(
      "id,assessed_at,score,outcome,findings,employee:employees!quality_assessments_employee_id_fkey(full_name,employee_code),reviewer:employees!quality_assessments_reviewer_id_fkey(full_name),task:tasks(title),project:projects(name),checklist:quality_checklists(name),evidence:quality_evidence(file_name,mime_type,size_bytes)",
    )
    .order("assessed_at", { ascending: false })
    .limit(5000);
  if (from) q = q.gte("assessed_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("assessed_at", `${to}T23:59:59Z`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "report unavailable" }, { status: 500 });
  const rows: any[][] = [
    [
      "Assessment ID",
      "Assessed at",
      "Employee",
      "Employee code",
      "Reviewer",
      "Task",
      "Project",
      "Checklist",
      "Score",
      "Outcome",
      "Findings",
      "Evidence files",
    ],
    ...(data ?? []).map((a: any) => [
      a.id,
      a.assessed_at,
      a.employee?.full_name,
      a.employee?.employee_code,
      a.reviewer?.full_name,
      a.task?.title,
      a.project?.name,
      a.checklist?.name,
      Number(a.score),
      a.outcome,
      a.findings,
      (a.evidence ?? []).map((f: any) => f.file_name).join("; "),
    ]),
  ];
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  await sb.rpc("log_audit", {
    p_action: "quality.report_exported",
    p_entity: "quality_assessments",
    p_entity_id: format,
    p_metadata: { rows: (data ?? []).length, from, to, format },
  });
  return reportResponse(rows, "vsm-ops-quality-assessments", format);
}
