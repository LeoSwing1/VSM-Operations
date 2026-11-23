"use server";
import { z } from "zod";
import { requirePerm, ROLES } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

const BACK = "/people/posts";
const lines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);

export async function savePost(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const p = z
    .object({
      title: z.string().trim().min(2).max(80),
      department_id: z.string().uuid().nullable(),
      default_role: z.enum(ROLES.filter((r) => r !== "SUPER_ADMIN") as [string, ...string[]]),
      team_key: z.enum(["seo", "editing", "developers"]).nullable(),
      team_role: z.enum(["LEAD", "MEMBER"]),
      reports_to: z.string().trim().max(80).nullable(),
    })
    .safeParse({
      title: str(fd, "title"),
      department_id: optStr(fd, "department_id"),
      default_role: str(fd, "default_role") || "EMPLOYEE",
      team_key: optStr(fd, "team_key"),
      team_role: str(fd, "team_role") || "MEMBER",
      reports_to: optStr(fd, "reports_to"),
    });
  if (!p.success) flash(BACK, "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("designations")
    .upsert(
      { org_id: ctx.org_id, ...p.data, responsibilities: lines(str(fd, "responsibilities")), kpis: lines(str(fd, "kpis")) },
      { onConflict: "org_id,title" },
    );
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", `Post “${p.data.title}” saved. New employees with this post join its department and team automatically.`);
}
