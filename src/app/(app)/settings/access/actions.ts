"use server";
import { z } from "zod";
import { requirePerm, ROLES, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { ALL_PERMS } from "@/lib/perms";

/** Saves the whole matrix in one go. The database decides what this user may change. */
export async function saveMatrix(fd: FormData) {
  const ctx = await requirePerm("roles.manage");
  const editable = new Set(
    String(fd.get("editable") ?? "")
      .split(",")
      .filter(Boolean),
  ); // "ROLE|perm" cells rendered as editable
  const sb = await supabaseServer();
  const { data: current } = await sb.from("role_permissions").select("role, permission");
  const have = new Set((current ?? []).map((c) => `${c.role}|${c.permission}`));
  const add: { org_id: string; role: Role; permission: string }[] = [];
  const remove: [Role, string][] = [];
  for (const cell of editable) {
    const [role, perm] = cell.split("|") as [Role, string];
    if (!ROLES.includes(role) || role === "SUPER_ADMIN" || !ALL_PERMS.includes(perm)) continue;
    const want = fd.get(cell) === "on";
    if (want && !have.has(cell)) add.push({ org_id: ctx.org_id, role, permission: perm });
    if (!want && have.has(cell)) remove.push([role, perm]);
  }
  let revoked = 0,
    blocked = 0;
  for (const [role, perm] of remove) {
    // RLS silently matches 0 rows when a revoke is above the caller's level — count what really happened.
    const { data, error } = await sb.from("role_permissions").delete().eq("role", role).eq("permission", perm).select("role");
    if (error) flash("/settings/access", "err", dbMessage(error));
    if (data?.length) revoked++;
    else blocked++;
  }
  if (add.length) {
    const { error } = await sb.from("role_permissions").insert(add);
    if (error) flash("/settings/access", "err", dbMessage(error, "Some of those permissions are above your level."));
  }
  if (!add.length && !remove.length) flash("/settings/access", "ok", "No changes.");
  flash(
    "/settings/access",
    blocked ? "err" : "ok",
    `Saved: ${add.length} granted, ${revoked} revoked${blocked ? `, ${blocked} blocked (above your level)` : ""}. Takes effect on the next page load and is recorded in the audit log.`,
  );
}

export async function saveRoleSetting(fd: FormData) {
  const ctx = await requirePerm("roles.manage");
  if (ctx.role !== "SUPER_ADMIN") flash("/settings/access?tab=hierarchy", "err", "Only a Super Admin can change the hierarchy.");
  const role = z.enum(ROLES as [Role, ...Role[]]).parse(str(fd, "role"));
  const level = Number(str(fd, "level"));
  if (role !== "SUPER_ADMIN" && !(level >= 1 && level <= 99))
    flash("/settings/access?tab=hierarchy", "err", "Level must be 1–99 (100 is reserved for Super Admin).");
  const sb = await supabaseServer();
  const patch: Record<string, unknown> = { label: str(fd, "label").slice(0, 60) || role, description: optStr(fd, "description") };
  if (role !== "SUPER_ADMIN") patch.level = level;
  const { error } = await sb.from("role_settings").update(patch).eq("role", role);
  if (error) flash("/settings/access?tab=hierarchy", "err", dbMessage(error));
  flash("/settings/access?tab=hierarchy", "ok", "Role updated.");
}

export async function addOverride(fd: FormData) {
  const ctx = await requirePerm("roles.manage");
  const emp = z.string().uuid().parse(str(fd, "employee_id"));
  const back = `/settings/access?tab=people&employee=${emp}`;
  if (ctx.role !== "SUPER_ADMIN") flash(back, "err", "Only a Super Admin can give personal permissions.");
  const perm = str(fd, "permission"),
    effect = str(fd, "effect"),
    reason = str(fd, "reason");
  if (!ALL_PERMS.includes(perm) || !["GRANT", "DENY"].includes(effect) || reason.length < 5)
    flash(back, "err", "Choose a permission, grant/deny and a reason (5+ characters).");
  const expires = optStr(fd, "expires_at");
  const sb = await supabaseServer();
  const { error } = await sb.from("employee_permission_overrides").upsert(
    {
      org_id: ctx.org_id,
      employee_id: emp,
      permission: perm,
      effect,
      reason,
      granted_by: ctx.employee_id,
      expires_at: expires ? new Date(`${expires}T23:59:59+05:30`).toISOString() : null,
    },
    { onConflict: "employee_id,permission" },
  );
  if (error) flash(back, "err", dbMessage(error, "Super Admins can't be overridden, and you can't override yourself."));
  flash(back, "ok", `${effect === "GRANT" ? "Granted" : "Denied"} ${perm}.`);
}

export async function removeOverride(fd: FormData) {
  await requirePerm("roles.manage");
  const emp = str(fd, "employee_id");
  const sb = await supabaseServer();
  const { error } = await sb.from("employee_permission_overrides").delete().eq("id", str(fd, "id"));
  if (error) flash(`/settings/access?tab=people&employee=${emp}`, "err", dbMessage(error));
  flash(`/settings/access?tab=people&employee=${emp}`, "ok", "Override removed.");
}

/** One toggle in the permission matrix — saved instantly. The database still enforces level, delegation and sensitivity rules. */
export async function togglePermission(role: string, perm: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  const ctx = await requirePerm("roles.manage");
  if (!ROLES.includes(role as Role) || role === "SUPER_ADMIN" || !ALL_PERMS.includes(perm))
    return { ok: false, message: "Unknown role or permission." };
  const sb = await supabaseServer();
  if (on) {
    const { error } = await sb
      .from("role_permissions")
      .upsert(
        { org_id: ctx.org_id, role: role as Role, permission: perm },
        { onConflict: "org_id,role,permission", ignoreDuplicates: true },
      );
    if (error) return { ok: false, message: dbMessage(error, "That permission is outside your authority.") };
    return { ok: true, message: "Granted" };
  }
  const { data, error } = await sb.from("role_permissions").delete().eq("role", role).eq("permission", perm).select("role");
  if (error) return { ok: false, message: dbMessage(error) };
  if (!data?.length) {
    const { count } = await sb
      .from("role_permissions")
      .select("role", { count: "exact", head: true })
      .eq("role", role)
      .eq("permission", perm);
    if (count) return { ok: false, message: "Blocked — that role is at or above your level." };
  }
  return { ok: true, message: "Revoked" };
}
