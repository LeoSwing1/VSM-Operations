"use server";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;

export async function createLead(fd: FormData) {
  const ctx = await requirePerm("crm.manage", "crm.view_all");
  const p = z.object({ name: z.string().trim().min(2).max(200), email: z.string().trim().email().nullable(), phone: z.string().trim().max(20).nullable() })
    .safeParse({ name: str(fd, "name"), email: optStr(fd, "email"), phone: optStr(fd, "phone") });
  if (!p.success || (!p.data.email && !p.data.phone)) flash("/leads", "err", "Name and an email or phone are required.");
  const source = z.enum(["PROJECT_ENQUIRY", "REFERRAL", "CAMPAIGN", "MANUAL", "OTHER"]).catch("MANUAL").parse(str(fd, "source"));
  const sb = await supabaseServer();
  const { data, error } = await sb.from("leads").insert({ ...p.data, org_id: ctx.org_id, company: optStr(fd, "company"), service_interest: optStr(fd, "service"),
    description: optStr(fd, "description"), source, source_detail: optStr(fd, "source_detail"), assigned_to: ctx.employee_id, created_by: ctx.employee_id }).select("id, duplicate_of").single();
  if (error) flash("/leads", "err", dbMessage(error));
  flash(`/leads/${data.id}`, data.duplicate_of ? "err" : "ok", data.duplicate_of ? "Saved — but this looks like a duplicate of an existing lead. Check below." : "Lead created.");
}

export async function updateLead(fd: FormData) {
  await requirePerm("crm.manage", "crm.assign");
  const id = z.string().uuid().parse(str(fd, "id")), back = `/leads/${id}`;
  const patch: Record<string, unknown> = {};
  const status = str(fd, "status");
  if (status) {
    patch.status = z.enum(STATUSES).parse(status);
    if (status === "LOST") { const r = optStr(fd, "lost_reason"); if (!r) flash(back, "err", "Give a reason when marking a lead lost."); patch.lost_reason = r; }
  }
  if (fd.has("priority")) patch.priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).parse(str(fd, "priority"));
  if (fd.has("assigned_to")) patch.assigned_to = optStr(fd, "assigned_to");
  if (fd.has("follow_up")) { const f = optStr(fd, "follow_up"); patch.next_follow_up_at = f ? zonedInstant(f.slice(0, 10), f.slice(11, 16) || "10:00").toISOString() : null; }
  const sb = await supabaseServer();
  const { data, error } = await sb.from("leads").update(patch).eq("id", id).select("id");
  if (error || !data?.length) flash(back, "err", dbMessage(error, "You can't update this lead."));
  flash(back, "ok", "Lead updated.");
}

export async function addActivity(fd: FormData) {
  const ctx = await requirePerm("crm.manage", "crm.view_all");
  const id = str(fd, "id"), back = `/leads/${id}`;
  const body = str(fd, "body");
  if (body.length < 2) flash(back, "err", "Write a note.");
  const kind = z.enum(["NOTE", "CALL", "EMAIL", "MEETING"]).catch("NOTE").parse(str(fd, "kind"));
  const sb = await supabaseServer();
  const { error } = await sb.from("lead_activities").insert({ org_id: ctx.org_id, lead_id: id, actor_id: ctx.employee_id, kind, body: body.slice(0, 4000) });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Logged.");
}

export async function convertLead(fd: FormData) {
  const ctx = await requirePerm("clients.manage");
  const id = str(fd, "id"), back = `/leads/${id}`;
  const sb = await supabaseServer();
  const { data: lead } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) flash("/leads", "err", "Lead not found.");
  if (lead.converted_client_id) flash(back, "err", "Already converted.");
  const { data: client, error } = await sb.from("clients").insert({ org_id: ctx.org_id, name: lead.company || lead.name, contact_name: lead.name, email: lead.email, phone: lead.phone,
    relationship_manager_id: lead.assigned_to ?? ctx.employee_id, status: "ACTIVE" }).select("id").single();
  if (error) flash(back, "err", dbMessage(error));
  await sb.from("leads").update({ converted_client_id: client.id, status: "WON" }).eq("id", id);
  flash(back, "ok", "Converted to a client.");
}
