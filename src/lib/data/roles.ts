import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type Ctx, type Role } from "@/lib/auth";

const has = (ctx: Ctx, p: string) => ctx.permissions.includes("*") || ctx.permissions.includes(p);
/** Roles executives/interns that HR posts and managers may add (mirrors can_add_employee()). */
export const JUNIOR_ROLES: Role[] = ["SALES_EXECUTIVE", "EMPLOYEE", "INTERN"];
/** Can this person add employees at all, and are they limited to their own team? */
export function addMode(ctx: Ctx): "all" | "juniors" | "team" | null {
  if (has(ctx, "people.manage")) return "all";
  if (has(ctx, "people.onboard")) return "juniors";
  if (has(ctx, "people.add_team")) return "team";
  return null;
}

/** Roles this user may assign (mirrors can_manage_role() / can_add_employee(); the DB still enforces it). */
export async function assignableRoles(sb: SupabaseClient, ctx: Ctx): Promise<{ role: Role; label: string }[]> {
  const { data } = await sb.from("role_settings").select("role, level, label");
  const rows = (data ?? []) as { role: Role; level: number; label: string }[];
  const mode = addMode(ctx);
  return ROLES.map((r) => rows.find((x) => x.role === r) ?? { role: r, level: 0, label: r })
    .filter((r) => mode === "all" || JUNIOR_ROLES.includes(r.role))
    .filter(
      (r) =>
        ctx.role === "SUPER_ADMIN" ||
        (r.role !== "SUPER_ADMIN" && (r.level < ctx.role_level || (mode !== "all" && JUNIOR_ROLES.includes(r.role)))),
    )
    .sort((a, b) => b.level - a.level)
    .map(({ role, label }) => ({ role, label }));
}
