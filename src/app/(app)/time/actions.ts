"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { localDate } from "@/lib/engines/time";
export async function submitTime(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      minutes: z.coerce.number().int().min(1).max(1440),
      description: z.string().trim().min(3).max(1000),
      task_id: z.string().uuid().optional(),
      project_id: z.string().uuid().optional(),
      billable: z.boolean(),
    })
    .refine((v) => !!v.task_id)
    .safeParse({
      work_date: str(fd, "work_date"),
      minutes: str(fd, "minutes"),
      description: str(fd, "description"),
      task_id: optStr(fd, "task_id") || undefined,
      project_id: optStr(fd, "project_id") || undefined,
      billable: str(fd, "billable") === "on",
    });
  if (!p.success) flash("/time", "err", "Add a date, duration, description and an assigned task.");
  if (p.data.work_date > localDate(new Date(), ctx.timezone)) flash("/time", "err", "You cannot submit time for a future date.");
  const sb = await supabaseServer();
  const { data: task } = await sb
    .from("tasks")
    .select("id,project_id")
    .eq("id", p.data.task_id!)
    .eq("assignee_id", ctx.employee_id)
    .maybeSingle();
  if (!task) flash("/time", "err", "Choose a task assigned to you.");
  const { data: entry, error } = await sb
    .from("task_time_entries")
    .insert({ org_id: ctx.org_id, employee_id: ctx.employee_id, ...p.data, project_id: task.project_id, status: "PENDING" })
    .select("id")
    .single();
  if (error) flash("/time", "err", dbMessage(error));
  const { error: workflowError } = await sb.rpc("enqueue_workflow_event", {
    p_event_key: "timesheet.submitted",
    p_idempotency_key: entry.id,
    p_payload: {
      actor_employee_id: ctx.employee_id,
      target_employee_id: ctx.employee_id,
      time_entry_id: entry.id,
      work_date: p.data.work_date,
      minutes: p.data.minutes,
    },
  });
  if (workflowError)
    await sb.rpc("log_audit", {
      p_action: "workflow.enqueue_failed",
      p_entity: "task_time_entry",
      p_entity_id: entry.id,
      p_metadata: { event_key: "timesheet.submitted", error: workflowError.message.slice(0, 300) },
    });
  revalidatePath("/time");
  flash("/time", "ok", "Time submitted for approval.");
}
export async function decideTime(fd: FormData) {
  await requirePerm("time.approve_all", "time.approve_team");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("decide_task_time_entry", { p_id: str(fd, "id"), p_approve: str(fd, "decision") === "approve" });
  if (error) flash("/time", "err", dbMessage(error));
  revalidatePath("/time");
  flash("/time", "ok", "Time entry decision saved.");
}

/** Starts a server-timestamped timer; one open timer per employee is enforced in SQL and checked here. */
export async function startTaskTimer(fd: FormData) {
  const ctx = await requireContext();
  const taskId = str(fd, "task_id");
  if (!z.string().uuid().safeParse(taskId).success) flash("/time", "err", "Choose a valid assigned task.");
  const sb = await supabaseServer();
  const [{ data: task }, { data: active }] = await Promise.all([
    sb.from("tasks").select("id,project_id").eq("id", taskId).eq("assignee_id", ctx.employee_id).maybeSingle(),
    sb
      .from("task_time_entries")
      .select("id")
      .eq("employee_id", ctx.employee_id)
      .not("started_at", "is", null)
      .is("ended_at", null)
      .limit(1)
      .maybeSingle(),
  ]);
  if (!task) flash("/time", "err", "Choose a task assigned to you.");
  if (active) flash("/time", "err", "Stop your running timer before starting another.");
  const { error } = await sb.from("task_time_entries").insert({
    org_id: ctx.org_id,
    employee_id: ctx.employee_id,
    task_id: task.id,
    project_id: task.project_id,
    work_date: localDate(new Date(), ctx.timezone),
    started_at: new Date().toISOString(),
    minutes: 1,
    description: "Timer session — add a work summary when stopping",
    billable: false,
    status: "PENDING",
  });
  if (error) flash("/time", "err", dbMessage(error));
  revalidatePath("/time");
  flash("/time", "ok", "Timer started. Stop it when you finish the task.");
}
export async function stopTaskTimer(fd: FormData) {
  const ctx = await requireContext(),
    id = str(fd, "id"),
    summary = str(fd, "description").trim();
  if (summary.length < 3 || summary.length > 1000) flash("/time", "err", "Add a short work summary (3–1000 characters).");
  const sb = await supabaseServer();
  const { data: entry, error: readError } = await sb
    .from("task_time_entries")
    .select("id,started_at")
    .eq("id", id)
    .eq("employee_id", ctx.employee_id)
    .is("ended_at", null)
    .maybeSingle();
  if (readError || !entry?.started_at) flash("/time", "err", "That timer is no longer running.");
  const end = new Date(),
    start = new Date(entry.started_at),
    minutes = Math.max(1, Math.min(1440, Math.ceil((end.getTime() - start.getTime()) / 60000)));
  const { error } = await sb
    .from("task_time_entries")
    .update({
      ended_at: end.toISOString(),
      minutes,
      description: summary,
      work_date: localDate(start, ctx.timezone),
      billable: str(fd, "billable") === "on",
    })
    .eq("id", id)
    .eq("employee_id", ctx.employee_id)
    .is("ended_at", null);
  if (error) flash("/time", "err", dbMessage(error));
  revalidatePath("/time");
  flash("/time", "ok", `Timer stopped. ${minutes} minutes submitted for approval.`);
}
