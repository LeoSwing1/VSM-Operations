"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, RETURN_CONDITIONS } from "@/lib/engines/assets";

const uuid = z.string().uuid();
const optDate = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const back = (fd: FormData, fallback: string) => {
  const b = str(fd, "back");
  return b.startsWith("/assets") || b === "/my-assets" ? b : fallback;
};

const AssetSchema = z.object({
  name: z.string().trim().min(2, "Give the asset a name").max(120),
  category: z.enum(ASSET_CATEGORIES.map((c) => c.key) as [string, ...string[]]),
  asset_tag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "Tag: letters, numbers and dashes only")
    .nullable(),
  brand: z.string().trim().max(80).nullable(),
  model: z.string().trim().max(120).nullable(),
  serial_no: z.string().trim().max(120).nullable(),
  identifier: z.string().trim().max(120).nullable(),
  condition: z.enum(ASSET_CONDITIONS),
  location: z.string().trim().max(120).nullable(),
  warranty_until: z.string().nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

function assetFields(fd: FormData) {
  return AssetSchema.safeParse({
    name: str(fd, "name"),
    category: str(fd, "category"),
    asset_tag: optStr(fd, "asset_tag"),
    brand: optStr(fd, "brand"),
    model: optStr(fd, "model"),
    serial_no: optStr(fd, "serial_no"),
    identifier: optStr(fd, "identifier"),
    condition: str(fd, "condition") || "GOOD",
    location: optStr(fd, "location"),
    warranty_until: optDate(fd, "warranty_until"),
    notes: optStr(fd, "notes"),
  });
}

function financials(fd: FormData) {
  const cost = num(fd, "purchase_cost");
  const life = num(fd, "useful_life_months");
  return {
    purchase_date: optDate(fd, "purchase_date"),
    purchase_cost: cost != null && cost >= 0 ? cost : null,
    vendor: optStr(fd, "vendor"),
    invoice_ref: optStr(fd, "invoice_ref"),
    useful_life_months: life && life >= 1 && life <= 240 ? Math.round(life) : 36,
  };
}
const hasFinancials = (f: ReturnType<typeof financials>) => f.purchase_date || f.purchase_cost != null || f.vendor || f.invoice_ref;

export async function createAsset(fd: FormData) {
  const ctx = await requirePerm("assets.manage");
  const parsed = assetFields(fd);
  if (!parsed.success) flash("/assets?add=1", "err", parsed.error.issues[0]?.message ?? "Check the details.");
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("assets")
    .insert({ ...parsed.data, org_id: ctx.org_id, asset_tag: parsed.data.asset_tag ?? "" })
    .select("id, asset_tag")
    .single();
  if (error) flash("/assets?add=1", "err", error.code === "23505" ? "That tag or serial number is already registered." : dbMessage(error));
  const f = financials(fd);
  if (hasFinancials(f)) {
    const { error: fe } = await sb.from("asset_financials").insert({ asset_id: data.id, org_id: ctx.org_id, ...f });
    if (fe) flash(`/assets/${data.id}`, "err", `Asset saved as ${data.asset_tag}, but purchase details failed: ${dbMessage(fe)}`);
  }
  revalidatePath("/assets");
  flash(`/assets/${data.id}`, "ok", `Added as ${data.asset_tag}.`);
}

export async function updateAsset(fd: FormData) {
  const ctx = await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "id"));
  if (!id.success) flash("/assets", "err", "Unknown asset.");
  const to = `/assets/${id.data}`;
  const parsed = assetFields(fd);
  if (!parsed.success) flash(to, "err", parsed.error.issues[0]?.message ?? "Check the details.");
  const sb = await supabaseServer();
  const { asset_tag, ...rest } = parsed.data;
  const { error } = await sb
    .from("assets")
    .update({ ...rest, ...(asset_tag ? { asset_tag } : {}) })
    .eq("id", id.data);
  if (error) flash(to, "err", error.code === "23505" ? "That tag or serial number is already registered." : dbMessage(error));
  if (fd.has("purchase_cost") || fd.has("vendor")) {
    const { error: fe } = await sb.from("asset_financials").upsert({ asset_id: id.data, org_id: ctx.org_id, ...financials(fd) });
    if (fe) flash(to, "err", dbMessage(fe));
  }
  revalidatePath(to);
  flash(to, "ok", "Saved.");
}

/** Retire stock kit, or bring retired / lost kit back into stock. */
export async function setStockStatus(fd: FormData) {
  await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "id"));
  const status = str(fd, "status");
  if (!id.success || !["RETIRED", "IN_STOCK"].includes(status)) flash("/assets", "err", "Unknown request.");
  const sb = await supabaseServer();
  const { error } = await sb.from("assets").update({ status }).eq("id", id.data);
  if (error) flash(`/assets/${id.data}`, "err", dbMessage(error));
  revalidatePath("/assets");
  flash(`/assets/${id.data}`, "ok", status === "RETIRED" ? "Retired — kept in the register for history." : "Back in stock.");
}

export async function issueAsset(fd: FormData) {
  await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "id")),
    emp = uuid.safeParse(str(fd, "employee_id"));
  const to = id.success ? `/assets/${id.data}` : "/assets";
  if (!id.success || !emp.success) flash(to, "err", "Choose who gets it.");
  const cond = str(fd, "condition");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("asset_issue", {
    p_asset: id.data,
    p_employee: emp.data,
    p_condition: (ASSET_CONDITIONS as readonly string[]).includes(cond) ? cond : null,
    p_expected_return: optDate(fd, "expected_return"),
    p_note: optStr(fd, "note"),
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/assets");
  flash(to, "ok", "Issued. They've been asked to confirm receipt in My assets.");
}

export async function returnAsset(fd: FormData) {
  await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "id"));
  const to = id.success ? back(fd, `/assets/${id.data}`) : "/assets";
  if (!id.success) flash(to, "err", "Unknown asset.");
  const cond = str(fd, "condition");
  if (!(RETURN_CONDITIONS as readonly string[]).includes(cond)) flash(to, "err", "Choose the condition it came back in.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("asset_return", { p_asset: id.data, p_condition: cond, p_note: optStr(fd, "note") });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/assets");
  flash(
    to,
    "ok",
    cond === "LOST" ? "Marked lost." : cond === "DAMAGED" ? "Returned — sent to repair with a ticket." : "Returned to stock.",
  );
}

export async function acknowledgeAsset(fd: FormData) {
  await requireContext();
  const id = uuid.safeParse(str(fd, "assignment_id"));
  if (!id.success) flash("/my-assets", "err", "Unknown item.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("asset_acknowledge", { p_assignment: id.data });
  if (error) flash("/my-assets", "err", dbMessage(error));
  revalidatePath("/my-assets");
  flash("/my-assets", "ok", "Thanks — receipt confirmed.");
}

export async function reportAssetIssue(fd: FormData) {
  await requireContext();
  const id = uuid.safeParse(str(fd, "id"));
  const to = back(fd, "/my-assets");
  if (!id.success) flash(to, "err", "Unknown item.");
  const text = str(fd, "description");
  if (text.length < 3) flash(to, "err", "Describe the problem.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("asset_report_issue", { p_asset: id.data, p_description: text.slice(0, 2000) });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath(to);
  flash(to, "ok", "Reported — the admin team has been told.");
}

/** Log planned work (service, inspection, upgrade, repair) from the asset page. */
export async function logMaintenance(fd: FormData) {
  const ctx = await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "id"));
  if (!id.success) flash("/assets", "err", "Unknown asset.");
  const to = `/assets/${id.data}`;
  const kind = str(fd, "kind");
  if (!["REPAIR", "SERVICE", "INSPECTION", "UPGRADE"].includes(kind)) flash(to, "err", "Choose the type of work.");
  const description = str(fd, "description");
  if (description.length < 3) flash(to, "err", "Describe the work.");
  const sb = await supabaseServer();
  const { error } = await sb.from("asset_maintenance").insert({
    org_id: ctx.org_id,
    asset_id: id.data,
    kind,
    description: description.slice(0, 2000),
    vendor: optStr(fd, "vendor"),
    next_due: optDate(fd, "next_due"),
    reported_by: ctx.employee_id,
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath(to);
  flash(to, "ok", "Logged.");
}

export async function updateMaintenance(fd: FormData) {
  await requirePerm("assets.manage");
  const id = uuid.safeParse(str(fd, "maintenance_id"));
  const to = back(fd, "/assets");
  if (!id.success) flash(to, "err", "Unknown ticket.");
  const status = str(fd, "status");
  if (!["IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) flash(to, "err", "Choose what happened.");
  const cost = num(fd, "cost");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("asset_maintenance_update", {
    p_id: id.data,
    p_status: status,
    p_resolution: optStr(fd, "resolution"),
    p_cost: cost != null && cost >= 0 ? cost : null,
    p_vendor: optStr(fd, "vendor"),
    p_next_due: optDate(fd, "next_due"),
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/assets");
  flash(to, "ok", status === "DONE" ? "Closed." : status === "CANCELLED" ? "Cancelled." : "Marked in repair.");
}
