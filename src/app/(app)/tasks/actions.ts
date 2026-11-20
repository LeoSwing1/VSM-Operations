"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";

const NewTask = z.object({
  title: z.string().trim().min(2).max(300), description: z.string().trim().max(5000).nullable(),
  assignee_id: z.string().uuid(), project_id: z.string().uuid().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]), deadline: z.string().nullable(), estimated_hours: z.number().min(0).max(999).nullable(),
});

export async function createTask(fd: FormData) {
  const ctx = await requireContext();
  const p = NewTask.safeParse({ title: str(fd, "title"), description: optStr(fd, "description"), assignee_id: str(fd, "assignee_id") || ctx.employee_id,
    project_id: optStr(fd, "project_id"), priority: str(fd, "priority") || "MEDIUM", deadline: optStr(fd, "deadline"), estimated_hours: num(fd, "estimated_hours") });
  if (!p.success) flash("/tasks", "err", p.error.issues[0]?.message ?? "Check the task form.");
  const sb = await supabaseServer();
  const deadline = p.data.deadline ? zonedInstant(p.data.deadline.slice(0, 10), p.data.deadline.slice(11, 16) || "18:00", ctx.timezone).toISOString() : null;
  const { error } = await sb.from("tasks").insert({ ...p.data, deadline, org_id: ctx.org_id, status: "TODO" });
  if (error) flash("/tasks", "err", dbMessage(error));
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
  const approve = str(fd, "decision") === "approve";
  const quality = num(fd, "quality");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("review_task", { p_task: str(fd, "id"), p_approve: approve, p_quality: approve ? quality : null, p_note: optStr(fd, "note") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", approve ? "Task approved and scored." : "Sent back for rework.");
}

export async function createProject(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const name = str(fd, "name");
  if (name.length < 2) flash("/tasks", "err", "Project name is required.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("projects").insert({ org_id: ctx.org_id, name, client_id: optStr(fd, "client_id"), deadline: optStr(fd, "deadline"),
    manager_id: ctx.employee_id, status: "ACTIVE" }).select("id").single();
  if (error) flash("/tasks", "err", dbMessage(error));
  await sb.from("project_members").insert({ project_id: data.id, employee_id: ctx.employee_id });
  flash("/tasks", "ok", "Project created.");
}
