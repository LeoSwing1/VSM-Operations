"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";

const BACK = "/settings/workflows";
const eventKeys = [
  "task.created",
  "task.due_soon",
  "task.overdue",
  "leave.submitted",
  "leave.decided",
  "attendance.incomplete",
  "timesheet.submitted",
  "timesheet.overdue",
  "quality.rework",
  "meeting.invitation",
] as const;
const schema = z.object({
  name: z.string().trim().min(3).max(120),
  event_key: z.enum(eventKeys),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1000),
  link: z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || v.startsWith("/")),
  recipient: z.enum(["actor", "event_target", "manager", "approval"]),
  subject: z.string().trim().max(180).optional(),
  details: z.string().trim().max(2000).optional(),
  sla_hours: z.coerce.number().int().min(1).max(720).optional(),
});
export async function createWorkflow(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const p = schema.safeParse({
    name: str(fd, "name"),
    event_key: str(fd, "event_key"),
    title: str(fd, "title"),
    body: str(fd, "body"),
    link: str(fd, "link"),
    recipient: str(fd, "recipient") || "actor",
    subject: str(fd, "subject"),
    details: str(fd, "details"),
    sla_hours: str(fd, "sla_hours") || "24",
  });
  if (!p.success) flash(BACK, "err", "Check the workflow name, trigger and notification details.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("workflow_rules")
    .insert({
      org_id: ctx.org_id,
      name: p.data.name,
      event_key: p.data.event_key,
      conditions: {},
      actions: [
        p.data.recipient === "approval"
          ? {
              type: "create_approval",
              subject: p.data.subject || p.data.title,
              details: p.data.details || p.data.body,
              sla_hours: p.data.sla_hours || 24,
            }
          : {
              type:
                p.data.recipient === "event_target" ? "notify_target" : p.data.recipient === "manager" ? "notify_manager" : "notify_actor",
              title: p.data.title,
              body: p.data.body,
              link: p.data.link || "/notifications",
            },
      ],
      created_by: ctx.employee_id,
      updated_by: ctx.employee_id,
    })
    .select("id")
    .single();
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: "workflow.rule_created",
    p_entity: "workflow_rule",
    p_entity_id: data.id,
    p_metadata: { name: p.data.name, event_key: p.data.event_key },
  });
  revalidatePath(BACK);
  flash(BACK, "ok", "Workflow created. It will run when its event is connected to a business action.");
}
export async function setWorkflowEnabled(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const id = str(fd, "id");
  const enabled = str(fd, "enabled") === "true";
  const sb = await supabaseServer();
  const { error } = await sb.from("workflow_rules").update({ enabled, updated_by: ctx.employee_id }).eq("id", id).eq("org_id", ctx.org_id);
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: enabled ? "workflow.enabled" : "workflow.disabled",
    p_entity: "workflow_rule",
    p_entity_id: id,
    p_metadata: { enabled },
  });
  revalidatePath(BACK);
  flash(BACK, "ok", enabled ? "Workflow enabled." : "Workflow paused.");
}
export async function deleteWorkflow(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const id = str(fd, "id");
  const sb = await supabaseServer();
  const { error } = await sb.from("workflow_rules").delete().eq("id", id).eq("org_id", ctx.org_id);
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", { p_action: "workflow.deleted", p_entity: "workflow_rule", p_entity_id: id, p_metadata: {} });
  revalidatePath(BACK);
  flash(BACK, "ok", "Workflow deleted; its queued runs were removed with the rule.");
}
