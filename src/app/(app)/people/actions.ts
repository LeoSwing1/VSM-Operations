"use server";
import { z } from "zod";
import { requirePerm, ROLES } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

const Employee = z.object({
  full_name: z.string().trim().min(2).max(120),
  official_email: z.string().trim().toLowerCase().email(),
  employee_code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/i, "Employee ID: letters, digits, dashes"),
  designation: z.string().trim().max(120).nullable(),
  department_id: z.string().uuid().nullable(),
  manager_id: z.string().uuid().nullable(),
  role: z.enum(ROLES as [string, ...string[]]),
  employment_type: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"]),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().trim().max(20).nullable(),
  shift_id: z.string().uuid().nullable(),
  work_location: z.string().trim().max(120).nullable(),
});

function read(fd: FormData) {
  return Employee.safeParse({
    full_name: str(fd, "full_name"), official_email: str(fd, "official_email"), employee_code: str(fd, "employee_code").toUpperCase(),
    designation: optStr(fd, "designation"), department_id: optStr(fd, "department_id"), manager_id: optStr(fd, "manager_id"),
    role: str(fd, "role") || "EMPLOYEE", employment_type: str(fd, "employment_type") || "FULL_TIME",
    joining_date: str(fd, "joining_date"), phone: optStr(fd, "phone"), shift_id: optStr(fd, "shift_id"), work_location: optStr(fd, "work_location"),
  });
}

export async function createEmployee(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const p = read(fd);
  if (!p.success) flash("/people?new=1", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  // 1) Insert under the caller's RLS — guards enforce who may grant which role.
  const { data: emp, error } = await sb.from("employees").insert({ ...p.data, org_id: ctx.org_id }).select("id").single();
  if (error) flash("/people?new=1", "err", dbMessage(error));
  // 2) Invite to Supabase Auth (service role used only after the permission check above).
  let note = "Employee added.";
  if (fd.get("invite") === "on") {
    try {
      const admin = supabaseAdmin();
      const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(p.data.official_email, {
        redirectTo: `${process.env.APP_URL ?? ""}/auth/callback?next=/login/reset`, data: { full_name: p.data.full_name },
      });
      if (invErr || !inv.user) throw invErr ?? new Error("no user");
      await admin.from("employees").update({ user_id: inv.user.id }).eq("id", emp.id).eq("org_id", ctx.org_id);
      note = "Employee added and invitation emailed.";
    } catch (e) {
      console.error("[invite]", (e as Error).message);
      note = "Employee added, but the invitation could not be sent. Retry from their profile.";
    }
  }
  flash(`/people/${emp.id}`, "ok", note);
}

export async function updateEmployee(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const p = read(fd);
  if (!p.success) flash(`/people/${id}?tab=edit`, "err", p.error.issues[0]?.message ?? "Check the form.");
  const status = z.enum(["ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "EXITED"]).parse(str(fd, "status") || "ACTIVE");
  const sb = await supabaseServer();
  const { error } = await sb.from("employees").update({ ...p.data, status, exit_date: optStr(fd, "exit_date") })
    .eq("id", id).eq("org_id", ctx.org_id);
  if (error) flash(`/people/${id}?tab=edit`, "err", dbMessage(error));
  flash(`/people/${id}`, "ok", "Profile updated.");
}

export async function resendInvite(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const sb = await supabaseServer();
  const { data: emp } = await sb.from("employees").select("id, official_email, full_name, user_id").eq("id", id).maybeSingle();
  if (!emp) flash("/people", "err", "Not found.");
  if (emp.user_id) flash(`/people/${id}`, "err", "This employee already has an account.");
  const admin = supabaseAdmin();
  const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(emp.official_email, {
    redirectTo: `${process.env.APP_URL ?? ""}/auth/callback?next=/login/reset`, data: { full_name: emp.full_name } });
  if (error || !inv.user) flash(`/people/${id}`, "err", "Invitation failed — check Supabase Auth email settings.");
  await admin.from("employees").update({ user_id: inv.user.id }).eq("id", id).eq("org_id", ctx.org_id);
  flash(`/people/${id}`, "ok", "Invitation sent.");
}

export async function createDepartment(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const name = z.string().trim().min(2).max(80).safeParse(str(fd, "name"));
  if (!name.success) flash("/people", "err", "Department name is required.");
  const sb = await supabaseServer();
  const { error } = await sb.from("departments").insert({ org_id: ctx.org_id, name: name.data });
  if (error) flash("/people", "err", dbMessage(error));
  flash("/people", "ok", "Department created.");
}
