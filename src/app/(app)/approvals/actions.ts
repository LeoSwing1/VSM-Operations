"use server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, decisionOf, flash, optStr, str } from "@/lib/actions";

export async function decide(fd: FormData) {
  await requireContext();
  const kind = str(fd, "kind"),
    id = str(fd, "id"),
    approve = decisionOf(fd, "/approvals"),
    note = optStr(fd, "note");
  const sb = await supabaseServer();
  const rpc = kind === "leave" ? "decide_leave" : kind === "correction" ? "decide_attendance_correction" : null;
  if (!rpc) flash("/approvals", "err", "Unknown request type.");
  const { data: decision, error } = await sb.rpc(rpc, { p_id: id, p_approve: approve, p_note: note });
  if (error) flash("/approvals", "err", dbMessage(error));
  if (kind === "leave" && decision?.employee_id) {
    const { error: workflowError } = await sb.rpc("enqueue_workflow_event", {
      p_event_key: "leave.decided",
      p_idempotency_key: id,
      p_payload: {
        actor_employee_id: (await requireContext()).employee_id,
        target_employee_id: decision.employee_id,
        leave_request_id: id,
        decision: approve ? "APPROVED" : "REJECTED",
      },
    });
    if (workflowError)
      await sb.rpc("log_audit", {
        p_action: "workflow.enqueue_failed",
        p_entity: "leave_request",
        p_entity_id: id,
        p_metadata: { event_key: "leave.decided", error: workflowError.message.slice(0, 300) },
      });
  }
  const saved = (decision as { status?: string } | null)?.status;
  flash("/approvals", "ok", saved ? `Saved as ${saved}.` : approve ? "Approved." : "Rejected.");
}

export async function decideWorkflowApproval(fd: FormData) {
  await requireContext();
  const id = str(fd, "id"),
    approve = decisionOf(fd, "/approvals"),
    note = optStr(fd, "note");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("workflow_approval_cases")
    .update({
      status: approve ? "APPROVED" : "REJECTED",
      decided_at: new Date().toISOString(),
      decision_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "PENDING");
  if (error) flash("/approvals", "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: approve ? "workflow.approval_approved" : "workflow.approval_rejected",
    p_entity: "workflow_approval_case",
    p_entity_id: id,
    p_metadata: { note },
  });
  flash("/approvals", "ok", approve ? "Workflow approval approved." : "Workflow approval rejected.");
}
