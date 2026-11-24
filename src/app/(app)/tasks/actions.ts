"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str, decisionOf } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";

const NewTask = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(5000).nullable(),
  assignee_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  deadline: z.string().nullable(),
  estimated_hours: z.number().min(0).max(999).nullable(),
});

export async function createTask(fd: FormData) {
  const ctx = await requireContext();
  const p = NewTask.safeParse({
    title: str(fd, "title"),
    description: optStr(fd, "description"),
    assignee_id: str(fd, "assignee_id") || ctx.employee_id,
    project_id: optStr(fd, "project_id"),
    priority: str(fd, "priority") || "MEDIUM",
    deadline: optStr(fd, "deadline"),
    estimated_hours: num(fd, "estimated_hours"),
  });
  if (!p.success) flash("/tasks", "err", p.error.issues[0]?.message ?? "Check the task form.");
  const sb = await supabaseServer();
  const deadline = p.data.deadline
    ? zonedInstant(p.data.deadline.slice(0, 10), p.data.deadline.slice(11, 16) || "18:00", ctx.timezone).toISOString()
    : null;
  const { data: task, error } = await sb
    .from("tasks")
    .insert({ ...p.data, deadline, org_id: ctx.org_id, status: "TODO" })
    .select("id")
    .single();
  if (error) flash("/tasks", "err", dbMessage(error));
  const { error: workflowError } = await sb.rpc("enqueue_workflow_event", {
    p_event_key: "task.created",
    p_idempotency_key: task.id,
    p_payload: {
      actor_employee_id: ctx.employee_id,
      target_employee_id: p.data.assignee_id,
      task_id: task.id,
      assignee_id: p.data.assignee_id,
      title: p.data.title,
    },
  });
  if (workflowError)
    await sb.rpc("log_audit", {
      p_action: "workflow.enqueue_failed",
      p_entity: "task",
      p_entity_id: task.id,
      p_metadata: { event_key: "task.created", error: workflowError.message.slice(0, 300) },
    });
  flash("/tasks", "ok", "Task created.");
}

const Move = z.object({ id: z.string().uuid(), status: z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "CANCELLED"]) });
export async function moveTask(fd: FormData) {
  await requireContext();
  const back = str(fd, "back") || "/tasks";
  const p = Move.safeParse({ id: str(fd, "id"), status: str(fd, "status") });
  if (!p.success) flash(back, "err", "Invalid status.");
  const sb = await supabaseServer();
  const patch: Record<string, unknown> = { status: p.data.status };
  const hours = num(fd, "actual_hours");
  if (hours !== null) patch.actual_hours = hours;
  const { data, error } = await sb.from("tasks").update(patch).eq("id", p.data.id).select("id");
  if (error) flash(back, "err", dbMessage(error));
  if (!data?.length) flash(back, "err", "You can't change that task.");
  revalidatePath("/tasks");
  flash(back, "ok", p.data.status === "REVIEW" ? "Submitted for review." : "Task updated.");
}

export async function reviewTask(fd: FormData) {
  await requirePerm("tasks.review");
  const back = str(fd, "back") || "/approvals";
  const approve = decisionOf(fd, back);
  const quality = num(fd, "quality");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("review_task", {
    p_task: str(fd, "id"),
    p_approve: approve,
    p_quality: approve ? quality : null,
    p_note: optStr(fd, "note"),
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", approve ? "Task approved and scored." : "Sent back for rework.");
}

export async function createProject(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const name = str(fd, "name");
  if (name.length < 2) flash("/tasks", "err", "Project name is required.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("projects")
    .insert({
      org_id: ctx.org_id,
      name,
      client_id: optStr(fd, "client_id"),
      deadline: optStr(fd, "deadline"),
      manager_id: ctx.employee_id,
      status: "ACTIVE",
    })
    .select("id")
    .single();
  if (error) flash("/tasks", "err", dbMessage(error));
  await sb.from("project_members").insert({ project_id: data.id, employee_id: ctx.employee_id });
  flash("/tasks", "ok", "Project created.");
}

/** Give work to a whole team: a copy for each member, or one shared task the first member claims. */
export async function createTeamTask(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      team_id: z.string().uuid(),
      mode: z.enum(["EACH", "SHARED"]),
      title: z.string().trim().min(2).max(300),
      description: z.string().trim().max(5000).nullable(),
      project_id: z.string().uuid().nullable(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
      deadline: z.string().nullable(),
      estimated_hours: z.number().min(0).max(999).nullable(),
    })
    .safeParse({
      team_id: str(fd, "team_id"),
      mode: str(fd, "mode") || "EACH",
      title: str(fd, "title"),
      description: optStr(fd, "description"),
      project_id: optStr(fd, "project_id"),
      priority: str(fd, "priority") || "MEDIUM",
      deadline: optStr(fd, "deadline"),
      estimated_hours: num(fd, "estimated_hours"),
    });
  if (!p.success) flash("/tasks?new=1", "err", p.error.issues[0]?.message ?? "Check the team task.");
  const deadline = p.data.deadline
    ? zonedInstant(p.data.deadline.slice(0, 10), p.data.deadline.slice(11, 16) || "18:00", ctx.timezone).toISOString()
    : null;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("create_team_task", {
    p_team: p.data.team_id,
    p_mode: p.data.mode,
    p_title: p.data.title,
    p_description: p.data.description,
    p_priority: p.data.priority,
    p_deadline: deadline,
    p_estimate: p.data.estimated_hours,
    p_project: p.data.project_id,
  });
  if (error) flash("/tasks?new=1", "err", dbMessage(error));
  revalidatePath("/tasks");
  flash(
    p.data.mode === "EACH" ? "/tasks?view=team" : "/tasks?view=open",
    "ok",
    p.data.mode === "EACH"
      ? `Assigned to ${data} team member${data === 1 ? "" : "s"}. Each got a notification.`
      : "Shared task posted to the team pool — everyone in the team was notified.",
  );
}

export async function claimTask(fd: FormData) {
  await requireContext();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) flash("/tasks?view=open", "err", "Unknown task.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("claim_team_task", { p_task: id.data });
  if (error) flash("/tasks?view=open", "err", dbMessage(error));
  revalidatePath("/tasks");
  flash(`/tasks?view=mine&focus=${id.data}`, "ok", "It's yours now — it's in My tasks.");
}
