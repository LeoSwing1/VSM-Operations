"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { createHash, randomUUID } from "node:crypto";
const evidenceTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
function validEvidence(file: File, b: Buffer) {
  if (file.type === "application/pdf") return b.subarray(0, 5).toString() === "%PDF-";
  if (file.type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (file.type === "image/png") return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.type === "image/webp") return b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  if (file.type === "text/plain") {
    try {
      return !b.includes(0) && !!new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      return false;
    }
  }
  return (file.type.includes("wordprocessingml") || file.type.includes("spreadsheetml")) && b[0] === 0x50 && b[1] === 0x4b;
}
export async function createChecklist(fd: FormData) {
  const ctx = await requirePerm("quality.manage");
  const name = str(fd, "name"),
    criteria = str(fd, "criteria")
      .split("\n")
      .map((v) => v.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 50);
  if (name.length < 2 || !criteria.length) flash("/quality", "err", "Give the checklist a name and at least one criterion.");
  const sb = await supabaseServer();
  const { error } = await sb.from("quality_checklists").insert({
    org_id: ctx.org_id,
    name,
    description: str(fd, "description"),
    criteria: criteria.map((label, index) => ({ id: `c${index + 1}`, label })),
    created_by: ctx.employee_id,
  });
  if (error) flash("/quality", "err", dbMessage(error));
  revalidatePath("/quality");
  flash("/quality", "ok", "Quality checklist created.");
}

export async function assessQuality(fd: FormData) {
  const ctx = await requirePerm("quality.review", "tasks.review");
  const score = str(fd, "score") === "" ? Number.NaN : Number(str(fd, "score"));
  const p = z
    .object({
      employee_id: z.string().uuid(),
      task_id: z.string().uuid().optional(),
      project_id: z.string().uuid().optional(),
      checklist_id: z.string().uuid().optional(),
      score: z.number().min(0).max(100),
      outcome: z.enum(["PASS", "REWORK", "FAIL"]),
      findings: z.string().max(2000),
    })
    .refine((v) => !!v.task_id || !!v.project_id)
    .safeParse({
      employee_id: str(fd, "employee_id"),
      task_id: optStr(fd, "task_id") || undefined,
      project_id: optStr(fd, "project_id") || undefined,
      checklist_id: optStr(fd, "checklist_id") || undefined,
      score,
      outcome: str(fd, "outcome"),
      findings: str(fd, "findings"),
    });
  if (!p.success) flash("/quality", "err", "Enter a valid employee, task or project and score from 0–100.");
  if (p.data.employee_id === ctx.employee_id) flash("/quality", "err", "You cannot assess your own work.");
  const files = fd.getAll("evidence").filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length > 8) flash("/quality", "err", "Upload a maximum of 8 evidence files per assessment.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024)
    flash("/quality", "err", "Total evidence upload size cannot exceed 50 MB per assessment.");
  const prepared = await Promise.all(files.map(async (file) => ({ file, bytes: Buffer.from(await file.arrayBuffer()) })));
  for (const item of prepared)
    if (item.file.size > 15 * 1024 * 1024 || !evidenceTypes.has(item.file.type) || !validEvidence(item.file, item.bytes))
      flash(
        "/quality",
        "err",
        `Unsupported or invalid evidence file: ${item.file.name}. Maximum 15 MB; valid PDF, JPG, PNG, WebP, TXT, DOCX or XLSX only.`,
      );
  const sb = await supabaseServer();
  const { data: assessment, error } = await sb
    .from("quality_assessments")
    .insert({ org_id: ctx.org_id, ...p.data, reviewer_id: ctx.employee_id })
    .select("id")
    .single();
  if (error || !assessment) flash("/quality", "err", dbMessage(error));
  const uploaded: string[] = [];
  const rollback = async () => {
    if (uploaded.length) await sb.storage.from("quality-evidence").remove(uploaded);
    await sb.from("quality_assessments").delete().eq("id", assessment.id).eq("reviewer_id", ctx.employee_id);
  };
  for (const { file, bytes } of prepared) {
    const digest = createHash("sha256").update(bytes).digest("hex"),
      clean =
        file.name
          .normalize("NFKC")
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(-120) || "evidence",
      path = `${ctx.org_id}/${assessment.id}/${randomUUID()}-${clean}`;
    const { error: uploadError } = await sb.storage.from("quality-evidence").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      await rollback();
      flash("/quality", "err", `Evidence upload failed: ${uploadError.message}`);
    }
    uploaded.push(path);
    const { error: metaError } = await sb.from("quality_evidence").insert({
      org_id: ctx.org_id,
      assessment_id: assessment.id,
      uploaded_by: ctx.employee_id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      sha256: digest,
    });
    if (metaError) {
      await rollback();
      flash("/quality", "err", dbMessage(metaError));
    }
  }
  if (p.data.outcome === "REWORK") {
    const { error: workflowError } = await sb.rpc("enqueue_workflow_event", {
      p_event_key: "quality.rework",
      p_idempotency_key: assessment.id,
      p_payload: {
        actor_employee_id: ctx.employee_id,
        target_employee_id: p.data.employee_id,
        assessment_id: assessment.id,
        task_id: p.data.task_id ?? null,
        project_id: p.data.project_id ?? null,
        score: p.data.score,
      },
    });
    if (workflowError)
      await sb.rpc("log_audit", {
        p_action: "workflow.enqueue_failed",
        p_entity: "quality_assessment",
        p_entity_id: assessment.id,
        p_metadata: { event_key: "quality.rework", error: workflowError.message.slice(0, 300) },
      });
  }
  revalidatePath("/quality");
  flash("/quality", "ok", `Quality assessment recorded with ${files.length} evidence file(s).`);
}
