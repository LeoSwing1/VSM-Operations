"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str, decisionOf } from "@/lib/actions";

export async function createProjectWorkspace(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const p = z
    .object({
      name: z.string().trim().min(2).max(160),
      description: z.string().trim().max(5000).nullable(),
      client_id: z.string().uuid().nullable(),
      start_date: z.string().nullable(),
      deadline: z.string().nullable(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
    })
    .safeParse({
      name: str(fd, "name"),
      description: optStr(fd, "description"),
      client_id: optStr(fd, "client_id"),
      start_date: optStr(fd, "start_date"),
      deadline: optStr(fd, "deadline"),
      priority: str(fd, "priority") || "MEDIUM",
    });
  if (!p.success) flash("/projects", "err", p.error.issues[0]?.message || "Check project details.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("projects")
    .insert({ ...p.data, org_id: ctx.org_id, manager_id: ctx.employee_id, status: "PLANNING" })
    .select("id")
    .single();
  if (error) flash("/projects", "err", dbMessage(error));
  await sb.from("project_members").upsert({ project_id: data.id, employee_id: ctx.employee_id });
  flash(`/projects/${data.id}`, "ok", "Project workspace created.");
}
export async function addMilestone(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const project = str(fd, "project_id");
  const p = z
    .object({
      title: z.string().trim().min(2).max(180),
      description: z.string().trim().max(2000).nullable(),
      owner_id: z.string().uuid().nullable(),
      due_date: z.string().nullable(),
    })
    .safeParse({
      title: str(fd, "title"),
      description: optStr(fd, "description"),
      owner_id: optStr(fd, "owner_id"),
      due_date: optStr(fd, "due_date"),
    });
  if (!p.success) flash(`/projects/${project}`, "err", "Invalid milestone details.");
  const sb = await supabaseServer();
  if (p.data.owner_id) {
    const { error: memberError } = await sb
      .from("project_members")
      .upsert({ project_id: project, employee_id: p.data.owner_id }, { onConflict: "project_id,employee_id" });
    if (memberError) flash(`/projects/${project}`, "err", dbMessage(memberError));
    const { data: channel } = await sb
      .from("chat_channels")
      .select("id")
      .eq("project_id", project)
      .eq("channel_type", "PROJECT")
      .maybeSingle();
    if (channel) {
      const { data: member } = await sb
        .from("chat_channel_members")
        .select("employee_id")
        .eq("channel_id", channel.id)
        .eq("employee_id", p.data.owner_id)
        .maybeSingle();
      if (!member) {
        const { error: chatError } = await sb.rpc("manage_chat_member", {
          p_channel: channel.id,
          p_employee: p.data.owner_id,
          p_action: "ADD",
          p_role: "MEMBER",
        });
        if (chatError) flash(`/projects/${project}`, "err", dbMessage(chatError));
      }
    }
  }
  const { error } = await sb
    .from("project_milestones")
    .insert({ ...p.data, org_id: ctx.org_id, project_id: project, created_by: ctx.employee_id });
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  revalidatePath(`/projects/${project}`);
  flash(`/projects/${project}`, "ok", "Milestone added.");
}
export async function moveMilestone(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const id = str(fd, "id"),
    project = str(fd, "project_id"),
    status = str(fd, "status");
  if (!["PENDING", "IN_PROGRESS", "COMPLETED", "AT_RISK"].includes(status))
    flash(`/projects/${project}`, "err", "Invalid milestone status.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("project_milestones")
    .update({ status, completed_at: status === "COMPLETED" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  revalidatePath(`/projects/${project}`);
  flash(`/projects/${project}`, "ok", "Milestone updated.");
}
export async function addProjectUpdate(fd: FormData) {
  const ctx = await requirePerm("projects.updates");
  const project = str(fd, "project_id");
  const p = z
    .object({ body: z.string().trim().min(2).max(5000), update_type: z.enum(["UPDATE", "RISK", "DECISION", "MILESTONE"]) })
    .safeParse({ body: str(fd, "body"), update_type: str(fd, "update_type") || "UPDATE" });
  if (!p.success) flash(`/projects/${project}`, "err", "Write a project update first.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("project_updates")
    .insert({ ...p.data, org_id: ctx.org_id, project_id: project, author_id: ctx.employee_id });
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  revalidatePath(`/projects/${project}`);
  flash(`/projects/${project}`, "ok", "Project update posted.");
}
export async function logProjectTime(fd: FormData) {
  const ctx = await requirePerm("projects.time_log");
  const project = str(fd, "project_id");
  const p = z
    .object({
      task_id: z.string().uuid().nullable(),
      work_date: z.string().min(10).max(10),
      hours: z.number().positive().max(24),
      notes: z.string().trim().min(2).max(1000),
      billable: z.boolean(),
    })
    .safeParse({
      task_id: optStr(fd, "task_id"),
      work_date: str(fd, "work_date"),
      hours: num(fd, "hours"),
      notes: str(fd, "notes"),
      billable: str(fd, "billable") === "on",
    });
  if (!p.success) flash(`/projects/${project}`, "err", "Check your time entry.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("project_time_entries")
    .insert({ ...p.data, org_id: ctx.org_id, project_id: project, employee_id: ctx.employee_id });
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  revalidatePath(`/projects/${project}`);
  flash(`/projects/${project}`, "ok", "Time entry submitted for approval.");
}
export async function decideProjectTime(fd: FormData) {
  await requirePerm("projects.time_approve", "projects.manage");
  const id = str(fd, "id"),
    approve = decisionOf(fd, "/projects/time");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("decide_project_time_entry", { p_entry: id, p_approve: approve, p_note: optStr(fd, "note") });
  if (error) flash("/projects/time", "err", dbMessage(error));
  revalidatePath("/projects/time");
  flash("/projects/time", "ok", approve ? "Time approved." : "Time rejected.");
}

export async function addProjectMembers(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const project = str(fd, "project_id");
  const ids = [
    ...new Set(
      fd
        .getAll("members")
        .map(String)
        .filter((v) => z.string().uuid().safeParse(v).success),
    ),
  ];
  if (!ids.length) flash(`/projects/${project}`, "err", "Select at least one project member.");
  const sb = await supabaseServer();
  const { error } = await sb.from("project_members").upsert(
    ids.map((employee_id) => ({ project_id: project, employee_id })),
    { onConflict: "project_id,employee_id" },
  );
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  const { data: channel } = await sb
    .from("chat_channels")
    .select("id")
    .eq("project_id", project)
    .eq("channel_type", "PROJECT")
    .maybeSingle();
  if (channel) {
    const { data: existing } = await sb.from("chat_channel_members").select("employee_id").eq("channel_id", channel.id);
    const known = new Set((existing ?? []).map((m: any) => m.employee_id));
    const additions = ids.filter((employee_id) => !known.has(employee_id));
    if (additions.length) {
      for (const employee_id of additions) {
        const { error: chatError } = await sb.rpc("manage_chat_member", {
          p_channel: channel.id,
          p_employee: employee_id,
          p_action: "ADD",
          p_role: "MEMBER",
        });
        if (chatError) flash(`/projects/${project}`, "err", dbMessage(chatError));
      }
    }
  }
  revalidatePath(`/projects/${project}`);
  flash(`/projects/${project}`, "ok", "Project roster updated.");
}
export async function createProjectChat(fd: FormData) {
  const ctx = await requirePerm("projects.manage");
  const project = str(fd, "project_id"),
    name = str(fd, "name");
  const sb = await supabaseServer();
  const { data: existing } = await sb
    .from("chat_channels")
    .select("id")
    .eq("project_id", project)
    .eq("channel_type", "PROJECT")
    .maybeSingle();
  if (existing) flash(`/projects/${project}`, "ok", "Project chat already exists.");
  const { data, error } = await sb
    .from("chat_channels")
    .insert({
      org_id: ctx.org_id,
      name: (name || "Project discussion").slice(0, 100),
      description: "Project team discussion",
      channel_type: "PROJECT",
      project_id: project,
      created_by: ctx.employee_id,
    })
    .select("id")
    .single();
  if (error) flash(`/projects/${project}`, "err", dbMessage(error));
  const { data: roster } = await sb.from("project_members").select("employee_id").eq("project_id", project);
  const memberIds = [...new Set([ctx.employee_id, ...(roster ?? []).map((m: any) => m.employee_id)])];
  for (const employee_id of memberIds) {
    const { error: memberError } = await sb.rpc("manage_chat_member", {
      p_channel: data.id,
      p_employee: employee_id,
      p_action: "ADD",
      p_role: employee_id === ctx.employee_id ? "OWNER" : "MEMBER",
    });
    if (memberError) flash(`/projects/${project}`, "err", dbMessage(memberError));
  }
  redirect(`/chat/${data.id}`);
}
