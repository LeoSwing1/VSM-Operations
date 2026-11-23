"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
export async function publishAnnouncement(fd: FormData) {
  const ctx = await requirePerm("communication.manage");
  const p = z
    .object({
      title: z.string().trim().min(3).max(180),
      body: z.string().trim().min(3).max(10000),
      audience: z.enum(["ALL", "DEPARTMENT", "PROJECT"]),
      department_id: z.string().uuid().nullable(),
      project_id: z.string().uuid().nullable(),
      pinned: z.boolean(),
    })
    .safeParse({
      title: str(fd, "title"),
      body: str(fd, "body"),
      audience: str(fd, "audience") || "ALL",
      department_id: optStr(fd, "department_id"),
      project_id: optStr(fd, "project_id"),
      pinned: str(fd, "pinned") === "on",
    });
  if (!p.success) flash("/announcements", "err", "Check announcement details.");
  if (p.data.audience === "DEPARTMENT" && !p.data.department_id) flash("/announcements", "err", "Choose a department.");
  if (p.data.audience === "PROJECT" && !p.data.project_id) flash("/announcements", "err", "Choose a project.");
  const sb = await supabaseServer();
  const { error } = await sb.from("company_announcements").insert({ ...p.data, org_id: ctx.org_id, created_by: ctx.employee_id });
  if (error) flash("/announcements", "err", dbMessage(error));
  revalidatePath("/announcements");
  flash("/announcements", "ok", "Announcement published.");
}
