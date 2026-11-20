import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Role =
  | "SUPER_ADMIN" | "ADMIN" | "HR_MANAGER" | "OPERATIONS_MANAGER" | "DEPARTMENT_MANAGER"
  | "TEAM_LEAD" | "SALES_EXECUTIVE" | "PROJECT_MANAGER" | "EMPLOYEE" | "INTERN";

export interface Ctx {
  employee_id: string;
  org_id: string;
  org_name: string;
  timezone: string;
  full_name: string;
  email: string;
  designation: string | null;
  role: Role;
  role_level: number;
  photo_url: string | null;
  permissions: string[];
}

/** Resolve the signed-in employee once per request. Permissions come from the DB, never the client. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("my_context");
  if (error || !data) return null;
  return data as Ctx;
});

export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login?e=no-employee");
  return ctx;
}

export function can(ctx: Ctx, perm: string): boolean {
  return ctx.permissions.includes("*") || ctx.permissions.includes(perm);
}
export function canAny(ctx: Ctx, perms: string[]): boolean {
  return perms.some((p) => can(ctx, p));
}

/** Page/action guard. UI hiding is cosmetic; this + RLS are the real controls. */
export async function requirePerm(...perms: string[]): Promise<Ctx> {
  const ctx = await requireContext();
  if (!canAny(ctx, perms)) redirect("/dashboard?err=" + encodeURIComponent("You don't have access to that area."));
  return ctx;
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin", ADMIN: "Admin", HR_MANAGER: "HR Manager", OPERATIONS_MANAGER: "Operations Manager",
  DEPARTMENT_MANAGER: "Department Manager", TEAM_LEAD: "Team Lead", SALES_EXECUTIVE: "Sales Executive",
  PROJECT_MANAGER: "Project Manager", EMPLOYEE: "Employee", INTERN: "Intern",
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];
