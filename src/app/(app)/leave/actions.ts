"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";

const Apply = z.object({
  leave_type_id: z.string().uuid(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  half_day: z.boolean(), reason: z.string().trim().min(3).max(2000),
}).refine((v) => v.end_date >= v.start_date, "End date must be on or after start date")
  .refine((v) => !v.half_day || v.start_date === v.end_date, "Half day must be a single date");

export async function applyLeave(fd: FormData) {
  const ctx = await requireContext();
  const p = Apply.safeParse({ leave_type_id: str(fd, "leave_type_id"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date") || str(fd, "start_date"),
    half_day: fd.get("half_day") === "on", reason: str(fd, "reason") });
  if (!p.success) flash("/leave", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { error } = await sb.from("leave_requests").insert({ ...p.data, org_id: ctx.org_id, employee_id: ctx.employee_id });
  if (error) flash("/leave", "err", dbMessage(error));
  flash("/leave", "ok", "Leave requested. Your manager has been notified.");
}

export async function cancelLeave(fd: FormData) {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data, error } = await sb.from("leave_requests").update({ status: "CANCELLED" }).eq("id", str(fd, "id")).eq("employee_id", ctx.employee_id).eq("status", "PENDING").select("id");
  if (error || !data?.length) flash("/leave", "err", "Only pending requests can be cancelled.");
  flash("/leave", "ok", "Request cancelled.");
}
