"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash } from "@/lib/actions";

const opt = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

export async function saveKyc(fd: FormData) {
  const ctx = await requireContext();
  const p = z
    .object({
      date_of_birth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      father_name: z.string().max(120).nullable(),
      personal_email: z.string().email("Personal email looks wrong").nullable(),
      personal_phone: z
        .string()
        .regex(/^\+?[0-9]{10,13}$/, "Phone: 10–13 digits")
        .nullable(),
      current_address: z.string().max(400).nullable(),
      permanent_address: z.string().max(400).nullable(),
      emergency_name: z.string().max(120).nullable(),
      emergency_relation: z.string().max(40).nullable(),
      emergency_phone: z
        .string()
        .regex(/^\+?[0-9]{10,13}$/, "Emergency phone: 10–13 digits")
        .nullable(),
      blood_group: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullable(),
      highest_education: z.string().max(160).nullable(),
      pan: z
        .string()
        .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F")
        .nullable(),
      aadhaar_last4: z
        .string()
        .regex(/^[0-9]{4}$/, "Only the last 4 digits of Aadhaar")
        .nullable(),
      bank_account_holder: z.string().max(120).nullable(),
      bank_account_no: z
        .string()
        .regex(/^[0-9]{9,18}$/, "Account number: 9–18 digits")
        .nullable(),
      bank_ifsc: z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234")
        .nullable(),
    })
    .safeParse({
      date_of_birth: opt(fd.get("date_of_birth")),
      father_name: opt(fd.get("father_name")),
      personal_email: opt(fd.get("personal_email"))?.toLowerCase() ?? null,
      personal_phone: opt(fd.get("personal_phone"))?.replace(/[\s-]/g, "") ?? null,
      current_address: opt(fd.get("current_address")),
      permanent_address: fd.get("same_address") === "on" ? opt(fd.get("current_address")) : opt(fd.get("permanent_address")),
      emergency_name: opt(fd.get("emergency_name")),
      emergency_relation: opt(fd.get("emergency_relation")),
      emergency_phone: opt(fd.get("emergency_phone"))?.replace(/[\s-]/g, "") ?? null,
      blood_group: opt(fd.get("blood_group")),
      highest_education: opt(fd.get("highest_education")),
      pan: opt(fd.get("pan"))?.toUpperCase() ?? null,
      aadhaar_last4: opt(fd.get("aadhaar_last4")),
      bank_account_holder: opt(fd.get("bank_account_holder")),
      bank_account_no: opt(fd.get("bank_account_no"))?.replace(/\s/g, "") ?? null,
      bank_ifsc: opt(fd.get("bank_ifsc"))?.toUpperCase() ?? null,
    });
  if (!p.success) flash("/kyc", "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("kyc_profiles")
    .update({ ...p.data, declaration_accepted: fd.get("declaration") === "on" })
    .eq("employee_id", ctx.employee_id)
    .select("employee_id");
  if (error || !data?.length) flash("/kyc", "err", dbMessage(error, "Your KYC is locked while HR reviews it."));
  revalidatePath("/kyc");
  flash("/kyc", "ok", fd.get("then") === "submit" ? "Saved." : "Saved as draft.");
}

const DOC_TYPES = ["PHOTO", "AADHAAR", "PAN", "ADDRESS_PROOF", "BANK_PROOF", "EDUCATION", "EXPERIENCE", "RELIEVING", "OTHER"] as const;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function uploadKycDoc(fd: FormData) {
  const ctx = await requireContext();
  const type = z.enum(DOC_TYPES).safeParse(fd.get("doc_type"));
  const file = fd.get("file");
  if (!type.success || !(file instanceof File) || file.size === 0) flash("/kyc", "err", "Choose the document type and a file.");
  if (file.size > 5 * 1024 * 1024) flash("/kyc", "err", "Each file must be under 5 MB.");
  if (!MIME.includes(file.type)) flash("/kyc", "err", "Upload a PDF, JPG, PNG or WEBP.");
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${ctx.org_id}/${ctx.employee_id}/${type.data.toLowerCase()}-${crypto.randomUUID()}.${ext}`;
  const sb = await supabaseServer();
  const up = await sb.storage.from("kyc-documents").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) flash("/kyc", "err", dbMessage(up.error, "Upload failed."));
  const { error } = await sb.from("kyc_documents").insert({
    org_id: ctx.org_id,
    employee_id: ctx.employee_id,
    doc_type: type.data,
    storage_path: path,
    original_name: file.name.slice(0, 255),
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (error) flash("/kyc", "err", dbMessage(error, "Your KYC is locked while HR reviews it."));
  revalidatePath("/kyc");
  flash("/kyc", "ok", "Document uploaded.");
}

export async function submitKyc() {
  await requireContext();
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kyc_submit");
  if (error) flash("/kyc", "err", dbMessage(error));
  revalidatePath("/kyc");
  flash("/kyc", "ok", "Submitted! HR will verify your documents — you'll get a notification.");
}

// ---------- HR ----------
export async function reviewKycDoc(fd: FormData) {
  await requirePerm("kyc.verify");
  const emp = String(fd.get("employee_id") ?? "");
  const to = `/people/kyc?e=${emp}`;
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) flash(to, "err", "Unknown document.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kyc_review_document", {
    p_doc: id.data,
    p_decision: String(fd.get("decision")),
    p_note: String(fd.get("note") ?? ""),
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/people/kyc");
  flash(to, "ok", fd.get("decision") === "VERIFIED" ? "Document verified." : "Document rejected — they'll be asked to re-upload.");
}

export async function reviewKyc(fd: FormData) {
  await requirePerm("kyc.verify");
  const emp = z.string().uuid().safeParse(fd.get("employee_id"));
  if (!emp.success) flash("/people/kyc", "err", "Unknown employee.");
  const to = `/people/kyc?e=${emp.data}`;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kyc_review", {
    p_emp: emp.data,
    p_decision: String(fd.get("decision")),
    p_note: String(fd.get("note") ?? ""),
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/people/kyc");
  flash(
    to,
    "ok",
    fd.get("decision") === "VERIFIED"
      ? "KYC verified. PAN and bank details were added to payroll where missing."
      : "Sent back with your note.",
  );
}

export async function remindKyc(fd: FormData) {
  await requirePerm("kyc.verify", "people.manage");
  const emp = z.string().uuid().safeParse(fd.get("employee_id"));
  if (!emp.success) flash("/people/kyc", "err", "Unknown employee.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kyc_remind", { p_emp: emp.data });
  if (error) flash("/people/kyc", "err", dbMessage(error));
  flash("/people/kyc", "ok", "Reminder sent to their chat.");
}
