"use server";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
import { drainWorkflowRuns } from "@/lib/workflows/worker";
import { drainOutbox } from "@/lib/email/worker";
import { drainDeliveries } from "@/lib/delivery/worker";

const BACK = "/operations";

/** Runs the queue workers once, right now, instead of waiting for the next cron tick. Admins only. */
export async function runWorkersNow() {
  const ctx = await requirePerm("settings.manage");
  const started = Date.now();
  const parts: string[] = [];
  const settle = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as Record<string, unknown>;
      const nums = Object.entries(r ?? {})
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => `${v} ${k}`);
      parts.push(`${label}: ${nums.join(", ") || "done"}`);
    } catch (e) {
      parts.push(`${label}: failed — ${(e as Error).message.slice(0, 120)}`);
    }
  };
  await settle("Workflows", () => drainWorkflowRuns(25));
  await settle("Email", () => drainOutbox(25));
  await settle("Channels", () => drainDeliveries(50));
  const sb = await supabaseServer();
  await sb.rpc("log_audit", {
    p_action: "operations.workers_run",
    p_entity: "operations",
    p_entity_id: ctx.org_id,
    p_metadata: { summary: parts.join(" | ").slice(0, 400) },
  });
  flash(BACK, "ok", `Workers ran in ${Date.now() - started} ms. ${parts.join(" · ")}`);
}

/** Requeues failed workflow runs (all, or one). The worker re-checks the rule before acting. */
export async function retryWorkflowRuns(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const id = str(fd, "id");
  let q = supabaseAdmin()
    .from("workflow_runs")
    .update({ status: "QUEUED", next_attempt_at: new Date().toISOString(), locked_at: null, error_message: null })
    .eq("org_id", ctx.org_id)
    .eq("status", "FAILED")
    .lt("attempts", 10);
  if (id) q = q.eq("id", id);
  const { data, error } = await q.select("id");
  if (error) flash(BACK, "err", dbMessage(error));
  const sb = await supabaseServer();
  await sb.rpc("log_audit", {
    p_action: "operations.workflow_retry",
    p_entity: "workflow_run",
    p_entity_id: id || "all",
    p_metadata: { count: data?.length ?? 0 },
  });
  flash(BACK, "ok", `${data?.length ?? 0} workflow runs queued again.`);
}

export async function retryAllDeliveries() {
  await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const [{ data: d, error: e1 }, { data: em, error: e2 }] = await Promise.all([
    sb.rpc("retry_failed_deliveries", { p_channel: null }),
    sb.rpc("retry_failed_emails"),
  ]);
  if (e1) flash(BACK, "err", dbMessage(e1));
  flash(BACK, "ok", `${d ?? 0} channel deliveries${e2 ? "" : ` and ${em ?? 0} emails`} queued again.`);
}

/** Manager / HR marks a flagged punch (offline, outside office) as reviewed. Rules are enforced in review_punch(). */
export async function reviewFlaggedPunch(fd: FormData) {
  await requireContext();
  const sb = await supabaseServer();
  const { error } = await sb.rpc("review_punch", { p_event: str(fd, "id"), p_note: str(fd, "note") || null });
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", "Punch reviewed.");
}
