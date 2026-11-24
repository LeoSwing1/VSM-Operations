import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reportFile, type ReportData, type ReportFormat } from "./build";

type Run = { id: string; org_id: string; report_type: string; format: ReportFormat; period_start: string; period_end: string };

/** Build one queued run: data (aggregates only) → file → private bucket → notify recipients (link only). */
export async function buildRun(run: Run): Promise<boolean> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db.rpc("report_data", {
      p_org: run.org_id,
      p_type: run.report_type,
      p_start: run.period_start,
      p_end: run.period_end,
    });
    if (error || !data) throw new Error(error?.message ?? "No data");
    const { data: org } = await db.from("organizations").select("name").eq("id", run.org_id).maybeSingle();
    const file = await reportFile(data as ReportData, run.format, org?.name ?? "VSM Growth Operations");
    const path = `${run.org_id}/${run.id}.${file.ext}`;
    const up = await db.storage.from("reports").upload(path, file.body, { contentType: file.contentType, upsert: true });
    if (up.error) throw new Error(up.error.message);
    await db.rpc("report_run_finished", {
      p_run: run.id,
      p_ok: true,
      p_path: path,
      p_rows: (data as ReportData).rows.length,
      p_error: null,
    });
    return true;
  } catch (e) {
    await db.rpc("report_run_finished", { p_run: run.id, p_ok: false, p_path: null, p_rows: null, p_error: (e as Error).message });
    return false;
  }
}

/** Scheduler tick: queue due schedules, then build up to `limit` runs. */
export async function processReports(limit = 5) {
  const db = supabaseAdmin();
  const { data: queued } = await db.rpc("claim_due_reports", { p_limit: 20 });
  const { data: runs, error } = await db.rpc("claim_report_runs", { p_limit: limit });
  if (error) throw new Error(error.message);
  let ok = 0,
    failed = 0;
  for (const r of (runs ?? []) as Run[]) (await buildRun(r)) ? ok++ : failed++;
  return { queued: queued ?? 0, built: ok, failed };
}
