"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

const uuid = z.string().uuid();
const STAGES = ["ENQUIRY", "COUNSELLED", "DEMO", "ENROLLED", "ALUMNI", "DROPPED", "LOST"] as const;
const SOURCES = ["WALK_IN", "WEBSITE", "INSTAGRAM", "REFERRAL", "AFFILIATE", "CAMPAIGN", "OTHER"] as const;
const phone = (v: string) => v.replace(/[\s()-]/g, "");

export async function addStudent(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      full_name: z.string().trim().min(2).max(120),
      phone: z
        .string()
        .transform(phone)
        .pipe(z.string().regex(/^\+?[0-9]{10,13}$/, "Phone: 10-digit mobile")),
      email: z.string().trim().email().optional().or(z.literal("")),
      city: z.string().trim().max(80).optional(),
      source: z.enum(SOURCES),
      interested_course_id: uuid.optional().or(z.literal("")),
      referral: z.string().trim().toUpperCase().max(16).optional(),
      affiliate_code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{3,32}$/)
        .optional()
        .or(z.literal("")),
      notes: z.string().trim().max(4000).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash("/scholars/students?new=1", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  let referred_by: string | null = null;
  if (p.data.referral) {
    const { data: ref } = await sb.from("scholar_students").select("id").eq("referral_code", p.data.referral).maybeSingle();
    if (!ref) flash("/scholars/students?new=1", "err", "Referral code not found.");
    referred_by = ref.id;
  }
  const { data, error } = await sb
    .from("scholar_students")
    .insert({
      org_id: ctx.org_id,
      full_name: p.data.full_name,
      phone: p.data.phone,
      email: p.data.email || null,
      city: p.data.city || null,
      source: referred_by ? "REFERRAL" : p.data.source,
      interested_course_id: p.data.interested_course_id || null,
      referred_by,
      affiliate_code: p.data.affiliate_code || null,
      notes: p.data.notes || null,
      counsellor_id: ctx.employee_id,
      created_by: ctx.employee_id,
      next_follow_up_at: new Date(Date.now() + 86400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error)
    flash(
      "/scholars/students?new=1",
      "err",
      error.code === "23505" ? "A student with this phone number already exists." : dbMessage(error),
    );
  flash(`/scholars/students/${data.id}`, "ok", "Enquiry added. Follow-up set for tomorrow.");
}

export async function updateStudent(fd: FormData) {
  await requireContext();
  const id = uuid.parse(str(fd, "id"));
  const back = `/scholars/students/${id}`;
  const stage = z.enum(STAGES).safeParse(str(fd, "stage"));
  if (!stage.success) flash(back, "err", "Choose a stage.");
  const follow = optStr(fd, "next_follow_up_at");
  if ((stage.data === "LOST" || stage.data === "DROPPED") && !str(fd, "lost_reason"))
    flash(back, "err", "Give a reason when marking lost or dropped.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("scholar_students")
    .update({
      stage: stage.data,
      counsellor_id: optStr(fd, "counsellor_id"),
      next_follow_up_at: follow ? new Date(follow).toISOString() : null,
      notes: str(fd, "notes").slice(0, 4000) || null,
      lost_reason: optStr(fd, "lost_reason"),
      interested_course_id: optStr(fd, "interested_course_id"),
    })
    .eq("id", id);
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Student updated.");
}

/** Enrol into a batch and create the fee schedule (1–12 instalments, monthly). */
export async function enrol(fd: FormData) {
  const ctx = await requireContext();
  const studentId = uuid.parse(str(fd, "student_id"));
  const back = `/scholars/students/${studentId}`;
  const p = z
    .object({
      batch_id: uuid,
      fee_total: z.coerce.number().min(0).max(1_000_000),
      discount: z.coerce.number().min(0).max(1_000_000),
      instalments: z.coerce.number().int().min(1).max(12),
      first_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({
      batch_id: str(fd, "batch_id"),
      fee_total: str(fd, "fee_total"),
      discount: str(fd, "discount") || 0,
      instalments: str(fd, "instalments") || 1,
      first_due: str(fd, "first_due"),
    });
  if (!p.success) flash(back, "err", p.error.issues[0]?.message ?? "Check the enrolment form.");
  if (p.data.discount > p.data.fee_total) flash(back, "err", "Discount can't be more than the fee.");
  const sb = await supabaseServer();
  const { data: batch } = await sb.from("scholar_batches").select("capacity, status").eq("id", p.data.batch_id).maybeSingle();
  if (!batch || ["COMPLETED", "CANCELLED"].includes(batch.status)) flash(back, "err", "That batch isn't open.");
  const { count } = await sb
    .from("scholar_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", p.data.batch_id)
    .neq("status", "DROPPED");
  if ((count ?? 0) >= batch.capacity) flash(back, "err", `Batch is full (${batch.capacity} seats).`);
  const { data: en, error } = await sb
    .from("scholar_enrollments")
    .insert({
      org_id: ctx.org_id,
      student_id: studentId,
      batch_id: p.data.batch_id,
      fee_total: p.data.fee_total,
      discount: p.data.discount,
      created_by: ctx.employee_id,
    })
    .select("id")
    .single();
  if (error) flash(back, "err", error.code === "23505" ? "Already enrolled in that batch." : dbMessage(error));
  const payable = Math.round((p.data.fee_total - p.data.discount) * 100) / 100;
  if (payable > 0) {
    const n = p.data.instalments,
      each = Math.floor((payable / n) * 100) / 100;
    const rows = Array.from({ length: n }, (_, i) => {
      const d = new Date(`${p.data.first_due}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      return {
        org_id: ctx.org_id,
        enrollment_id: en.id,
        amount: i === n - 1 ? Math.round((payable - each * (n - 1)) * 100) / 100 : each,
        due_on: d.toISOString().slice(0, 10),
        recorded_by: ctx.employee_id,
      };
    });
    const { error: fErr } = await sb.from("scholar_fee_payments").insert(rows);
    if (fErr) flash(back, "err", `Enrolled, but the fee schedule failed: ${dbMessage(fErr)}`);
  }
  flash(
    back,
    "ok",
    `Enrolled. ${payable > 0 ? `Fee schedule: ₹${payable.toLocaleString("en-IN")} in ${p.data.instalments} instalment(s).` : "No fee due."}`,
  );
}

export async function confirmFee(fd: FormData) {
  await requireContext();
  const back = str(fd, "back") || "/scholars";
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("scholar_confirm_payment", {
    p_payment: str(fd, "id"),
    p_method: str(fd, "method"),
    p_reference: str(fd, "reference"),
    p_paid_on: str(fd, "paid_on") || new Date().toISOString().slice(0, 10),
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", `Payment confirmed · receipt ${(data as { receipt_no: string }).receipt_no}.`);
}

export async function waiveFee(fd: FormData) {
  await requireContext();
  const back = str(fd, "back") || "/scholars";
  const sb = await supabaseServer();
  const { error } = await sb.rpc("scholar_waive_payment", { p_payment: str(fd, "id"), p_reason: str(fd, "reason") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Instalment waived.");
}

export async function issueCertificate(fd: FormData) {
  await requireContext();
  const back = str(fd, "back") || "/scholars";
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("scholar_issue_certificate", {
    p_enrollment: str(fd, "enrollment_id"),
    p_grade: str(fd, "grade") || "PASS",
    p_min_attendance: Number(str(fd, "min_attendance") || 75),
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", `Certificate ${(data as { certificate_no: string }).certificate_no} issued.`);
}

export async function revokeCertificate(fd: FormData) {
  await requireContext();
  const back = str(fd, "back") || "/scholars";
  if (str(fd, "reason").length < 5) flash(back, "err", "Give a reason (5+ characters).");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("scholar_revoke_certificate", { p_certificate: str(fd, "id"), p_reason: str(fd, "reason") });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Certificate revoked. The verification page now shows REVOKED.");
}

export async function saveCourse(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2,6}$/, "Code: 2–6 letters"),
      name: z.string().trim().min(3).max(120),
      duration_weeks: z.coerce.number().int().min(1).max(104),
      fee: z.coerce.number().min(0).max(1_000_000),
      description: z.string().trim().max(1000).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash("/scholars/courses", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("scholar_courses")
    .upsert({ org_id: ctx.org_id, ...p.data, is_active: true }, { onConflict: "org_id,code" });
  if (error) flash("/scholars/courses", "err", dbMessage(error));
  flash("/scholars/courses", "ok", `${p.data.name} saved.`);
}

export async function saveBatch(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      course_id: uuid,
      name: z.string().trim().min(2).max(80),
      trainer_id: uuid.optional().or(z.literal("")),
      starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ends_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .or(z.literal("")),
      schedule: z.string().trim().max(120).optional(),
      mode: z.enum(["OFFLINE", "ONLINE", "HYBRID"]),
      location: z.string().trim().max(80).optional(),
      capacity: z.coerce.number().int().min(1).max(500),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash("/scholars/batches", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("scholar_batches")
    .insert({ org_id: ctx.org_id, ...p.data, trainer_id: p.data.trainer_id || null, ends_on: p.data.ends_on || null })
    .select("id")
    .single();
  if (error) flash("/scholars/batches", "err", error.code === "23505" ? "A batch with that name exists." : dbMessage(error));
  flash(`/scholars/batches/${data.id}`, "ok", "Batch created.");
}

export async function setBatchStatus(fd: FormData) {
  await requireContext();
  const id = uuid.parse(str(fd, "id"));
  const sb = await supabaseServer();
  const { error } = await sb
    .from("scholar_batches")
    .update({ status: z.enum(["PLANNED", "RUNNING", "COMPLETED", "CANCELLED"]).parse(str(fd, "status")) })
    .eq("id", id);
  if (error) flash(`/scholars/batches/${id}`, "err", dbMessage(error));
  flash(`/scholars/batches/${id}`, "ok", "Batch status updated.");
}

/** Trainer marks a class: date, topic and who was present. Re-saving the same date updates it. */
export async function markClass(fd: FormData) {
  const ctx = await requireContext();
  const batchId = uuid.parse(str(fd, "batch_id"));
  const back = `/scholars/batches/${batchId}`;
  const date = str(fd, "session_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > new Date().toISOString().slice(0, 10)) flash(back, "err", "Choose today or a past date.");
  const sb = await supabaseServer();
  const { data: s, error } = await sb
    .from("scholar_sessions")
    .upsert(
      {
        org_id: ctx.org_id,
        batch_id: batchId,
        session_date: date,
        topic: str(fd, "topic").slice(0, 200) || null,
        marked_by: ctx.employee_id,
      },
      { onConflict: "batch_id,session_date" },
    )
    .select("id")
    .single();
  if (error) flash(back, "err", dbMessage(error));
  const students = fd.getAll("student").map(String);
  const present = new Set(fd.getAll("present").map(String));
  if (students.length) {
    const { error: aErr } = await sb
      .from("scholar_session_attendance")
      .upsert(students.map((id) => ({ session_id: s.id, student_id: id, org_id: ctx.org_id, present: present.has(id) })));
    if (aErr) flash(back, "err", dbMessage(aErr));
  }
  flash(back, "ok", `Class on ${date} saved: ${present.size}/${students.length} present.`);
}
