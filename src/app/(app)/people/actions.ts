"use server";
import { z } from "zod";
import { requirePerm, requireContext, ROLES } from "@/lib/auth";
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


export async function toggleOnboardingItem(fd: FormData) {
  const ctx = await requireContext();
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const completed = str(fd, "completed") === "on";
  if (employeeId !== ctx.employee_id && !ctx.permissions.includes("*") && !ctx.permissions.includes("people.manage")) {
    flash(`/people/${employeeId}?tab=onboarding`, "err", "You cannot update this onboarding checklist.");
  }
  const sb = await supabaseServer();
  const { error } = await sb.from("onboarding_checklist_items").update({
    completed_at: completed ? new Date().toISOString() : null,
    completed_by: ctx.employee_id,
  }).eq("id", id).eq("employee_id", employeeId).eq("org_id", ctx.org_id);
  if (error) flash(`/people/${employeeId}?tab=onboarding`, "err", dbMessage(error));
  flash(`/people/${employeeId}?tab=onboarding`, "ok", "Onboarding checklist updated.");
}

export async function addOnboardingItem(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const p = z.object({
    employee_id: z.string().uuid(),
    title: z.string().trim().min(2).max(160),
    category: z.enum(["DOCUMENTS", "IT_ACCESS", "HR_ORIENTATION", "TEAM_SETUP", "GENERAL"]),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).safeParse({
    employee_id: str(fd, "employee_id"), title: str(fd, "title"),
    category: str(fd, "category") || "GENERAL", due_date: optStr(fd, "due_date"),
  });
  if (!p.success) flash("/people", "err", p.error.issues[0]?.message ?? "Check checklist item.");
  const sb = await supabaseServer();
  const { error } = await sb.from("onboarding_checklist_items").insert({ ...p.data, org_id: ctx.org_id });
  if (error) flash(`/people/${p.data.employee_id}?tab=onboarding`, "err", dbMessage(error));
  flash(`/people/${p.data.employee_id}?tab=onboarding`, "ok", "Onboarding item added.");
}

export async function removeOnboardingItem(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const sb = await supabaseServer();
  const { error } = await sb.from("onboarding_checklist_items").delete().eq("id", id).eq("employee_id", employeeId).eq("org_id", ctx.org_id);
  if (error) flash(`/people/${employeeId}?tab=onboarding`, "err", dbMessage(error));
  flash(`/people/${employeeId}?tab=onboarding`, "ok", "Onboarding item removed.");
}

const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;

export async function uploadEmployeeDocument(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const title = z.string().trim().min(2).max(160).parse(str(fd, "title"));
  const category = z.enum(["IDENTITY", "EDUCATION", "EMPLOYMENT", "TAX", "BANK", "POLICY", "OTHER"]).parse(str(fd, "category"));
  const expiresOn = optStr(fd, "expires_on");
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) flash(`/people/${employeeId}?tab=documents`, "err", "Invalid expiry date.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024 || !DOC_TYPES.includes(file.type as typeof DOC_TYPES[number])) {
    flash(`/people/${employeeId}?tab=documents`, "err", "Upload a PDF, JPG, PNG, WEBP or Word document up to 10 MB.");
  }
  const sb = await supabaseServer();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "document";
  const id = crypto.randomUUID();
  const path = `${ctx.org_id}/${employeeId}/${id}-${safeName}`;
  const { error: storageError } = await sb.storage.from("employee-private").upload(path, file, { contentType: file.type, upsert: false });
  if (storageError) flash(`/people/${employeeId}?tab=documents`, "err", dbMessage(storageError));
  const { error } = await sb.from("employee_documents").insert({
    id, org_id: ctx.org_id, employee_id: employeeId, category, title, storage_path: path,
    original_name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size,
    expires_on: expiresOn || null, uploaded_by: ctx.employee_id,
  });
  if (error) {
    await sb.storage.from("employee-private").remove([path]);
    flash(`/people/${employeeId}?tab=documents`, "err", dbMessage(error));
  }
  flash(`/people/${employeeId}?tab=documents`, "ok", "Private employee document uploaded.");
}

export async function deleteEmployeeDocument(fd: FormData) {
  await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const sb = await supabaseServer();
  const { data: doc } = await sb.from("employee_documents").select("id,storage_path").eq("id", id).eq("employee_id", employeeId).maybeSingle();
  if (!doc) flash(`/people/${employeeId}?tab=documents`, "err", "Document not found or access denied.");
  const { error } = await sb.storage.from("employee-private").remove([doc.storage_path]);
  if (error) flash(`/people/${employeeId}?tab=documents`, "err", dbMessage(error));
  const { error: rowError } = await sb.from("employee_documents").delete().eq("id", id).eq("employee_id", employeeId);
  if (rowError) flash(`/people/${employeeId}?tab=documents`, "err", dbMessage(rowError));
  flash(`/people/${employeeId}?tab=documents`, "ok", "Document deleted.");
}

export async function createProbationReview(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const p = z.object({ employee_id: z.string().uuid(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), comments: z.string().trim().max(4000).nullable() }).safeParse({
    employee_id: str(fd, "employee_id"), due_date: str(fd, "due_date"), comments: optStr(fd, "comments"),
  });
  if (!p.success) flash("/people", "err", p.error.issues[0]?.message ?? "Check probation review.");
  const sb = await supabaseServer();
  const { error } = await sb.from("probation_reviews").insert({ ...p.data, org_id: ctx.org_id, reviewer_id: ctx.employee_id });
  if (error) flash(`/people/${p.data.employee_id}?tab=probation`, "err", dbMessage(error));
  flash(`/people/${p.data.employee_id}?tab=probation`, "ok", "Probation review created.");
}

export async function updateProbationReview(fd: FormData) {
  await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const action = z.enum(["SUBMIT", "CONFIRM", "EXTEND", "EXIT"]).parse(str(fd, "review_action"));
  const comments = z.string().trim().max(4000).nullable().parse(optStr(fd, "comments"));
  const sb = await supabaseServer();
  let error;
  if (action === "SUBMIT") {
    ({ error } = await sb.rpc("submit_probation_review", { p_review_id: id, p_comments: comments }));
  } else {
    const nextReviewDate = action === "EXTEND" ? str(fd, "next_review_date") : null;
    if (action === "EXTEND" && !/^\d{4}-\d{2}-\d{2}$/.test(nextReviewDate ?? "")) flash(`/people/${employeeId}?tab=probation`, "err", "Choose a valid next review date.");
    ({ error } = await sb.rpc("decide_probation_review", { p_review_id: id, p_recommendation: action, p_comments: comments, p_next_review_date: nextReviewDate }));
  }
  if (error) flash(`/people/${employeeId}?tab=probation`, "err", dbMessage(error));
  flash(`/people/${employeeId}?tab=probation`, "ok", "Probation review updated.");
}

export async function addExitClearanceItem(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const p = z.object({ employee_id: z.string().uuid(), category: z.enum(["MANAGER", "IT", "FINANCE", "HR", "ADMIN", "OTHER"]), title: z.string().trim().min(2).max(160), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).safeParse({
    employee_id: str(fd, "employee_id"), category: str(fd, "category"), title: str(fd, "title"), due_date: optStr(fd, "due_date"),
  });
  if (!p.success) flash("/people", "err", p.error.issues[0]?.message ?? "Check clearance item.");
  const sb = await supabaseServer();
  const { error } = await sb.from("exit_clearance_items").insert({ ...p.data, org_id: ctx.org_id });
  if (error) flash(`/people/${p.data.employee_id}?tab=exit`, "err", dbMessage(error));
  flash(`/people/${p.data.employee_id}?tab=exit`, "ok", "Exit clearance item added.");
}

export async function toggleExitClearanceItem(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const completed = str(fd, "completed") === "on";
  const { error } = await (await supabaseServer()).from("exit_clearance_items").update({ completed_at: completed ? new Date().toISOString() : null, completed_by: completed ? ctx.employee_id : null }).eq("id", id).eq("employee_id", employeeId).eq("org_id", ctx.org_id);
  if (error) flash(`/people/${employeeId}?tab=exit`, "err", dbMessage(error));
  flash(`/people/${employeeId}?tab=exit`, "ok", "Exit clearance updated.");
}

export async function issueEmployeeLetter(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const letterType = z.enum(["OFFER", "APPOINTMENT", "EXPERIENCE", "RELIEVING"]).parse(str(fd, "letter_type"));
  const sb = await supabaseServer();
  const { data: employee } = await sb.from("employees").select("id,employee_code,full_name,designation,joining_date,employment_type,status,department:departments(name),organization:organizations(name)").eq("id", employeeId).maybeSingle();
  if (!employee) flash(`/people/${employeeId}?tab=letters`, "err", "Employee not found.");
  if ((letterType === "EXPERIENCE" || letterType === "RELIEVING") && employee.status !== "EXITED") flash(`/people/${employeeId}?tab=letters`, "err", "Experience and relieving letters can only be issued after exit is completed.");
  const issuedOn = new Date().toISOString().slice(0, 10);
  const referenceNo = `VSM/${letterType}/${issuedOn.slice(0, 4)}/${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const snapshot = {
    company_name: (employee as any).organization?.name ?? "VSM Growth",
    employee_name: employee.full_name, employee_code: employee.employee_code,
    designation: employee.designation ?? "Team Member", department: (employee as any).department?.name ?? null,
    joining_date: employee.joining_date, employment_type: employee.employment_type,
    issued_on: issuedOn, letter_type: letterType,
  };
  const { data: letter, error } = await sb.from("employee_letters").insert({ org_id: ctx.org_id, employee_id: employeeId, letter_type: letterType, reference_no: referenceNo, issued_on: issuedOn, snapshot, issued_by: ctx.employee_id }).select("id").single();
  if (error) flash(`/people/${employeeId}?tab=letters`, "err", dbMessage(error));
  flash(`/people/${employeeId}/letters/${letter.id}`, "ok", "Employment letter issued. Use Print → Save as PDF to download a PDF copy.");
}

export async function revokeEmployeeLetter(fd: FormData) {
  await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const { error } = await (await supabaseServer()).rpc("revoke_employee_letter", { p_letter_id: id });
  if (error) flash(`/people/${employeeId}?tab=letters`, "err", dbMessage(error));
  flash(`/people/${employeeId}?tab=letters`, "ok", "Letter revoked and audit event recorded.");
}
