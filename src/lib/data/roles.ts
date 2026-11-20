import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type Ctx, type Role } from "@/lib/auth";

/** Roles this user may assign (mirrors can_manage_role(); the DB still enforces it). */
export async function assignableRoles(sb: SupabaseClient, ctx: Ctx): Promise<{ role: Role; label: string }[]> {
  const { data } = await sb.from("role_settings").select("role, level, label");
  const rows = (data ?? []) as { role: Role; level: number; label: string }[];
  return ROLES.map((r) => rows.find((x) => x.role === r) ?? { role: r, level: 0, label: r })
    .filter((r) => ctx.role === "SUPER_ADMIN" || (r.role !== "SUPER_ADMIN" && r.level < ctx.role_level))
    .sort((a, b) => b.level - a.level)
    .map(({ role, label }) => ({ role, label }));
}
