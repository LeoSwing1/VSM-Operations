import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { REPORT_TYPES } from "@/lib/reports/build";

export const dynamic = "force-dynamic";

/** Download a generated report. Row-level security decides access (you must hold that report's permission). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", _req.nextUrl.origin));
  const sb = await supabaseServer();
  const { data: run } = await sb
    .from("report_runs")
    .select("id,org_id,report_type,format,period_start,period_end,status,file_path")
    .eq("id", id)
    .maybeSingle();
  if (!run || run.status !== "READY" || !run.file_path || !run.file_path.startsWith(`${ctx.org_id}/`)) {
    return NextResponse.json({ error: "Report not found or not ready." }, { status: 404 });
  }
  const { data: file, error } = await supabaseAdmin().storage.from("reports").download(run.file_path);
  if (error || !file) return NextResponse.json({ error: "File missing." }, { status: 404 });
  const ext = run.file_path.split(".").pop();
  const name = `${(REPORT_TYPES[run.report_type]?.label ?? run.report_type).replace(/[^A-Za-z0-9]+/g, "-")}_${run.period_start}_${run.period_end}.${ext}`;
  await sb.rpc("log_audit", {
    p_action: "reports.downloaded",
    p_entity: "report_run",
    p_entity_id: run.id,
    p_metadata: { type: run.report_type },
  });
  return new NextResponse(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
