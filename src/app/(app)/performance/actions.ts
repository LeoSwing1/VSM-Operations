"use server";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";
import { computeForEmployee } from "@/lib/data/performance";
import { METRIC_KEYS, validateWeights, type Weights } from "@/lib/engines/performance";

const Period = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function createSnapshot(fd: FormData) {
  const ctx = await requirePerm("performance.review", "performance.configure");
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const { start, end } = Period.parse({ start: str(fd, "start"), end: str(fd, "end") });
  const back = `/performance?month=${start}`;
  const sb = await supabaseServer();
  const live = await computeForEmployee(sb, employeeId, start, end, ctx.timezone);
  if (!live) flash(back, "err", "Employee not in your scope.");
  if (!live.policy) flash(back, "err", "No active performance policy. Configure one first.");
  // Replace any existing DRAFT for the same period (keeps history as SUPERSEDED).
  await sb.from("performance_snapshots").update({ status: "SUPERSEDED" }).eq("employee_id", employeeId).eq("period_start", start).eq("period_end", end).eq("status", "DRAFT");
  const r = live.result;
  const { error } = await sb.from("performance_snapshots").insert({
    org_id: ctx.org_id, employee_id: employeeId, policy_id: live.policy.id, period_start: start, period_end: end,
    metrics: { attendance: live.attendance && { ...live.attendance, days: undefined }, updates: live.updates, task_ids: live.tasks.map((t: any) => t.id) },
    components: r.components, computed_score: r.score, final_score: r.score, category: r.category, coverage: r.coverage, computed_by: ctx.employee_id,
  });
  if (error) flash(back, "err", dbMessage(error, "An approved snapshot already exists for this period."));
  flash(back, "ok", r.score === null ? `Snapshot saved — insufficient data (${r.coverage}% coverage).` : `Snapshot saved: ${r.score}.`);
}

export async function adjustSnapshot(fd: FormData) {
  await requirePerm("performance.review", "performance.configure");
  const back = str(fd, "back") || "/performance";
  const delta = num(fd, "delta");
  const reason = str(fd, "reason");
  if (delta === null || delta === 0 || Math.abs(delta) > 20 || reason.length < 10) flash(back, "err", "Adjustment must be ±0.5–20 with a reason of 10+ characters.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("adjust_snapshot", { p_snapshot: str(fd, "id"), p_delta: delta, p_reason: reason });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Adjustment recorded with reason.");
}

export async function approveSnapshot(fd: FormData) {
  await requirePerm("performance.review", "performance.configure");
  const back = str(fd, "back") || "/performance";
  const sb = await supabaseServer();
  const { error } = await sb.rpc("approve_snapshot", { p_snapshot: str(fd, "id") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Snapshot approved. It can now feed payroll incentives.");
}

export async function submitReview(fd: FormData) {
  const ctx = await requirePerm("performance.review");
  const back = str(fd, "back") || "/performance";
  const rating = num(fd, "rating");
  if (rating === null || rating < 0 || rating > 100) flash(back, "err", "Rating must be 0–100.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("manager_reviews").insert({
    org_id: ctx.org_id, employee_id: str(fd, "employee_id"), reviewer_id: ctx.employee_id,
    period_start: str(fd, "start"), period_end: str(fd, "end"), rating, shared_comments: optStr(fd, "shared"),
  }).select("id").single();
  if (error) flash(back, "err", dbMessage(error));
  const notes = optStr(fd, "private");
  if (notes) await sb.from("manager_review_notes").insert({ review_id: data.id, org_id: ctx.org_id, private_notes: notes });
  flash(back, "ok", "Review saved. Shared comments are visible to the employee; private notes are not.");
}

export async function savePolicy(fd: FormData) {
  const ctx = await requirePerm("performance.configure");
  const weights: Weights = {};
  for (const k of METRIC_KEYS) { const v = num(fd, `w_${k}`); if (v) weights[k] = v; }
  const errs = validateWeights(weights);
  if (errs.length) flash("/performance?tab=policy", "err", errs.join(". "));
  const minCoverage = num(fd, "min_coverage") ?? 60;
  const sb = await supabaseServer();
  const id = optStr(fd, "id");
  const row = { org_id: ctx.org_id, name: str(fd, "name") || "Policy", weights, min_coverage: minCoverage,
    department_id: optStr(fd, "department_id"), role: optStr(fd, "role"), created_by: ctx.employee_id };
  const { error } = id ? await sb.from("performance_policies").update(row).eq("id", id) : await sb.from("performance_policies").insert(row);
  if (error) flash("/performance?tab=policy", "err", dbMessage(error));
  await sb.rpc("log_audit", { p_action: "performance.policy_saved", p_entity: "performance_policy", p_entity_id: id ?? "new", p_metadata: { weights } });
  flash("/performance?tab=policy", "ok", "Policy saved. New snapshots will use these weights.");
}

export async function requestReview(fd: FormData) {
  const ctx = await requireContext();
  const message = str(fd, "message");
  if (message.length < 10) flash("/analytics/my-performance", "err", "Explain what you'd like reviewed (10+ characters).");
  const sb = await supabaseServer();
  const { error } = await sb.from("performance_review_requests").insert({ org_id: ctx.org_id, snapshot_id: str(fd, "snapshot_id"), employee_id: ctx.employee_id, message });
  if (error) flash("/analytics/my-performance", "err", dbMessage(error));
  flash("/analytics/my-performance", "ok", "Review requested. Your manager and HR can see it.");
}

export async function respondReviewRequest(fd: FormData) {
  const ctx = await requirePerm("performance.review", "performance.view_all");
  const sb = await supabaseServer();
  const status = str(fd, "decision") === "approve" ? "APPROVED" : "REJECTED";
  const { error } = await sb.from("performance_review_requests").update({ status, response: optStr(fd, "response"), responded_by: ctx.employee_id }).eq("id", str(fd, "id")).eq("status", "PENDING");
  if (error) flash("/performance", "err", dbMessage(error));
  flash("/performance", "ok", "Response sent.");
}
