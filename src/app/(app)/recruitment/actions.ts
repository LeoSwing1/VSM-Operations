"use server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
const Candidate = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).nullable(),
  role_applied: z.string().trim().min(2).max(120),
  department_id: z.string().uuid().nullable(),
  source: z.enum(["DIRECT", "REFERRAL", "JOB_BOARD", "LINKEDIN", "WEBSITE", "OTHER"]),
  owner_id: z.string().uuid().nullable(),
  notes: z.string().trim().max(5000).nullable(),
});
export async function createCandidate(fd: FormData) {
  const ctx = await requirePerm("recruit.manage");
  const p = Candidate.safeParse({
    full_name: str(fd, "full_name"),
    email: str(fd, "email"),
    phone: optStr(fd, "phone"),
    role_applied: str(fd, "role_applied"),
    department_id: optStr(fd, "department_id"),
    source: str(fd, "source") || "DIRECT",
    owner_id: optStr(fd, "owner_id"),
    notes: optStr(fd, "notes"),
  });
  if (!p.success) flash("/recruitment?new=1", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { error } = await sb.from("candidates").insert({ ...p.data, org_id: ctx.org_id, created_by: ctx.employee_id });
  if (error) flash("/recruitment?new=1", "err", dbMessage(error));
  flash("/recruitment", "ok", "Candidate added to the recruitment pipeline.");
}
export async function updateCandidateStage(fd: FormData) {
  const ctx = await requirePerm("recruit.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const stage = z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"]).parse(str(fd, "stage"));
  const rejection_reason = optStr(fd, "rejection_reason");
  if (stage === "REJECTED" && (!rejection_reason || rejection_reason.length < 3))
    flash("/recruitment", "err", "Add a short rejection reason for the candidate record.");
  const sb = await supabaseServer();
  const { error } = await sb.from("candidates").update({ stage, rejection_reason }).eq("id", id).eq("org_id", ctx.org_id);
  if (error) flash("/recruitment", "err", dbMessage(error));
  flash("/recruitment", "ok", "Candidate stage updated.");
}
export async function scheduleInterview(fd: FormData) {
  const ctx = await requirePerm("recruit.manage");
  const p = z
    .object({
      candidate_id: z.string().uuid(),
      interviewer_id: z.string().uuid().nullable(),
      scheduled_at: z.string().min(10),
      interview_type: z.enum(["SCREENING", "TECHNICAL", "CULTURE", "FINAL", "OTHER"]),
    })
    .safeParse({
      candidate_id: str(fd, "candidate_id"),
      interviewer_id: optStr(fd, "interviewer_id"),
      scheduled_at: str(fd, "scheduled_at"),
      interview_type: str(fd, "interview_type") || "TECHNICAL",
    });
  if (!p.success) flash("/recruitment", "err", p.error.issues[0]?.message ?? "Check interview details.");
  const sb = await supabaseServer();
  const scheduledAt = fromZonedTime(p.data.scheduled_at, ctx.timezone).toISOString();
  const { error } = await sb.from("candidate_interviews").insert({ ...p.data, scheduled_at: scheduledAt, org_id: ctx.org_id });
  if (error) flash("/recruitment", "err", dbMessage(error));
  await sb
    .from("candidates")
    .update({ stage: "INTERVIEW" })
    .eq("id", p.data.candidate_id)
    .eq("org_id", ctx.org_id)
    .in("stage", ["APPLIED", "SCREENING"]);
  flash("/recruitment", "ok", "Interview scheduled.");
}
export async function saveInterviewFeedback(fd: FormData) {
  const ctx = await requirePerm("recruit.manage");
  const p = z
    .object({
      id: z.string().uuid(),
      result: z.enum(["PENDING", "PASS", "FAIL", "ON_HOLD"]),
      score: z.preprocess((v) => (v == null ? null : Number(v)), z.number().min(0).max(100).nullable()),
      feedback: z.string().trim().max(4000).nullable(),
    })
    .safeParse({ id: str(fd, "id"), result: str(fd, "result"), score: optStr(fd, "score"), feedback: optStr(fd, "feedback") });
  if (!p.success) flash("/recruitment", "err", "Invalid interview feedback.");
  const sb = await supabaseServer();
  const { id, ...changes } = p.data;
  const { error } = await sb.from("candidate_interviews").update(changes).eq("id", id).eq("org_id", ctx.org_id);
  if (error) flash("/recruitment", "err", dbMessage(error));
  flash("/recruitment", "ok", "Interview feedback saved.");
}

export async function hireCandidate(fd: FormData) {
  const ctx = await requirePerm("recruit.manage", "people.manage");
  const p = z
    .object({
      id: z.string().uuid(),
      employee_code: z
        .string()
        .trim()
        .min(2)
        .max(20)
        .regex(/^[A-Za-z0-9-]+$/),
      joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      employment_type: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"]),
    })
    .safeParse({
      id: str(fd, "id"),
      employee_code: str(fd, "employee_code"),
      joining_date: str(fd, "joining_date"),
      employment_type: str(fd, "employment_type") || "FULL_TIME",
    });
  if (!p.success) flash("/recruitment", "err", p.error.issues[0]?.message ?? "Check hire details.");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("hire_candidate", {
    p_candidate: p.data.id,
    p_employee_code: p.data.employee_code,
    p_joining_date: p.data.joining_date,
    p_employment_type: p.data.employment_type,
  });
  if (error) flash("/recruitment", "err", dbMessage(error));
  flash(`/people/${data}`, "ok", "Candidate hired and employee profile created.");
}
