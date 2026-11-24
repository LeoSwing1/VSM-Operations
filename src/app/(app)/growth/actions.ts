"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash } from "@/lib/actions";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const back = (fd: FormData, fallback: string) => {
  const b = String(fd.get("back") ?? "");
  return b.startsWith("/growth") ? b : fallback;
};
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

// ---------- OKRs ----------
export async function createObjective(fd: FormData) {
  const ctx = await requireContext();
  const to = back(fd, "/growth");
  const p = z
    .object({
      title: z.string().trim().min(3, "Objective: at least 3 characters").max(200),
      description: z.string().trim().max(2000).optional(),
      level: z.enum(["COMPANY", "TEAM", "PERSONAL"]),
      team_id: uuid.optional(),
      owner_id: uuid.optional(),
      parent_id: uuid.optional(),
      period_start: date,
      period_end: date,
    })
    .safeParse(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, blank(v)])));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the form.");
  if (p.data.level === "TEAM" && !p.data.team_id) flash(to, "err", "Pick the team for a team objective.");
  const sb = await supabaseServer();
  const { error } = await sb.from("okr_objectives").insert({
    org_id: ctx.org_id,
    title: p.data.title,
    description: p.data.description || null,
    level: p.data.level,
    team_id: p.data.level === "TEAM" ? p.data.team_id : null,
    owner_id: p.data.owner_id ?? ctx.employee_id,
    parent_id: p.data.parent_id ?? null,
    period_start: p.data.period_start,
    period_end: p.data.period_end,
    created_by: ctx.employee_id,
  });
  if (error) flash(to, "err", dbMessage(error, "You can't create an objective at that level."));
  revalidatePath("/growth");
  flash(to, "ok", "Objective added — now add 2–4 measurable key results.");
}

export async function addKeyResult(fd: FormData) {
  const ctx = await requireContext();
  const to = back(fd, "/growth");
  const p = z
    .object({
      objective_id: uuid,
      title: z.string().trim().min(3, "Key result: at least 3 characters").max(200),
      metric: z.enum(["NUMBER", "PERCENT", "CURRENCY", "BOOLEAN"]),
      start_value: z.coerce.number().finite().default(0),
      target_value: z.coerce.number().finite(),
      unit: z.string().trim().max(20).optional(),
      weight: z.coerce.number().int().min(1).max(10).default(1),
      owner_id: uuid.optional(),
    })
    .safeParse(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, blank(v)])));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the key result.");
  const d = p.data;
  const start = d.metric === "BOOLEAN" ? 0 : d.start_value;
  const target = d.metric === "BOOLEAN" ? 1 : d.target_value;
  if (target === start) flash(to, "err", "Target must differ from the starting value.");
  const sb = await supabaseServer();
  const { error } = await sb.from("okr_key_results").insert({
    org_id: ctx.org_id,
    objective_id: d.objective_id,
    title: d.title,
    metric: d.metric,
    start_value: start,
    target_value: target,
    current_value: start,
    unit: d.unit || (d.metric === "PERCENT" ? "%" : d.metric === "CURRENCY" ? "₹" : null),
    weight: d.weight,
    owner_id: d.owner_id ?? null,
  });
  if (error) flash(to, "err", dbMessage(error, "You can't add key results to this objective."));
  revalidatePath("/growth");
  flash(to, "ok", "Key result added.");
}

export async function checkIn(fd: FormData) {
  await requireContext();
  const to = back(fd, "/growth");
  const p = z
    .object({
      kr: uuid,
      value: z.coerce.number().finite(),
      confidence: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK"]),
      note: z.string().trim().max(1000).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash(to, "err", "Enter the new value.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("okr_checkin", {
    p_kr: p.data.kr,
    p_value: p.data.value,
    p_confidence: p.data.confidence,
    p_note: p.data.note ?? null,
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth");
  flash(to, "ok", "Check-in saved.");
}

export async function setObjectiveStatus(fd: FormData) {
  await requireContext();
  const to = back(fd, "/growth");
  const id = uuid.safeParse(fd.get("id"));
  const status = z.enum(["DRAFT", "ACTIVE", "CLOSED"]).safeParse(fd.get("status"));
  if (!id.success || !status.success) flash(to, "err", "Unknown objective.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("okr_objectives").update({ status: status.data }).eq("id", id.data).select("id");
  if (error || !data?.length) flash(to, "err", dbMessage(error, "You can't change this objective."));
  revalidatePath("/growth");
  flash(to, "ok", status.data === "CLOSED" ? "Objective closed." : "Objective updated.");
}

// ---------- KPIs ----------
export async function saveKpiValue(fd: FormData) {
  const ctx = await requireContext();
  const to = back(fd, "/growth/kpis");
  const p = z
    .object({
      kpi_id: uuid,
      employee_id: uuid,
      month: z.string().regex(/^\d{4}-\d{2}-01$/),
      value: z.coerce.number().finite(),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) flash(to, "err", "Enter a number.");
  const sb = await supabaseServer();
  const { data: existing } = await sb
    .from("kpi_values")
    .select("id")
    .eq("kpi_id", p.data.kpi_id)
    .eq("employee_id", p.data.employee_id)
    .eq("period_month", p.data.month)
    .maybeSingle();
  const { error } = existing
    ? await sb
        .from("kpi_values")
        .update({ value: p.data.value, note: p.data.note || null, entered_by: ctx.employee_id })
        .eq("id", existing.id)
    : await sb.from("kpi_values").insert({
        org_id: ctx.org_id,
        kpi_id: p.data.kpi_id,
        employee_id: p.data.employee_id,
        period_month: p.data.month,
        value: p.data.value,
        note: p.data.note || null,
        entered_by: ctx.employee_id,
      });
  if (error) flash(to, "err", dbMessage(error, "You can't enter this KPI (verified values are locked)."));
  revalidatePath("/growth/kpis");
  flash(to, "ok", "KPI saved.");
}

export async function verifyKpi(fd: FormData) {
  await requireContext();
  const to = back(fd, "/growth/kpis");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) flash(to, "err", "Unknown value.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("kpi_verify", { p_id: id.data });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/kpis");
  flash(to, "ok", "Verified.");
}

export async function refreshKpis(fd: FormData) {
  const ctx = await requireContext();
  const to = back(fd, "/growth/kpis");
  const month = String(fd.get("month") ?? "");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("kpi_refresh", { p_org: ctx.org_id, p_month: /^\d{4}-\d{2}-01$/.test(month) ? month : null });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/kpis");
  flash(to, "ok", `Recalculated ${data ?? 0} automatic KPI values.`);
}

export async function saveKpiDefinition(fd: FormData) {
  const ctx = await requireContext();
  const to = "/growth/kpis?tab=setup";
  const p = z
    .object({
      id: uuid.optional(),
      designation_id: uuid.optional(),
      name: z.string().trim().min(2).max(120),
      unit: z.string().trim().max(20).optional(),
      direction: z.enum(["HIGHER", "LOWER"]),
      target: z.coerce.number().finite().optional(),
      source: z.string().regex(/^[A-Z_]{3,30}$/),
      weight: z.coerce.number().int().min(1).max(10).default(1),
      is_active: z.enum(["on"]).optional(),
    })
    .safeParse(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, blank(v)])));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the KPI.");
  const sb = await supabaseServer();
  const row = {
    org_id: ctx.org_id,
    designation_id: p.data.designation_id ?? null,
    name: p.data.name,
    unit: p.data.unit || null,
    direction: p.data.direction,
    target: p.data.target ?? null,
    source: p.data.source,
    weight: p.data.weight,
    is_active: p.data.id ? p.data.is_active === "on" : true,
  };
  const { error } = p.data.id
    ? await sb.from("kpi_definitions").update(row).eq("id", p.data.id)
    : await sb.from("kpi_definitions").insert(row);
  if (error) flash(to, "err", dbMessage(error, "Only KPI managers can change KPI definitions."));
  revalidatePath("/growth/kpis");
  flash(to, "ok", "KPI saved.");
}

// ---------- 360 reviews ----------
export async function createCycle(fd: FormData) {
  const ctx = await requireContext();
  const to = "/growth/reviews?tab=manage";
  const p = z
    .object({
      name: z.string().trim().min(3).max(120),
      period_start: date,
      period_end: date,
      due_on: date.optional(),
      peers_per_person: z.coerce.number().int().min(0).max(6),
      anonymous_peers: z.enum(["on"]).optional(),
    })
    .safeParse(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, blank(v)])));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the cycle.");
  const sb = await supabaseServer();
  const { error } = await sb.from("review_cycles").insert({
    org_id: ctx.org_id,
    name: p.data.name,
    period_start: p.data.period_start,
    period_end: p.data.period_end,
    due_on: p.data.due_on ?? null,
    peers_per_person: p.data.peers_per_person,
    anonymous_peers: p.data.anonymous_peers === "on",
    created_by: ctx.employee_id,
  });
  if (error) flash(to, "err", dbMessage(error, "Only HR can create review cycles."));
  revalidatePath("/growth/reviews");
  flash(to, "ok", "Cycle created as a draft. Open it when you're ready — everyone gets their forms.");
}

export async function openCycle(fd: FormData) {
  await requireContext();
  const to = "/growth/reviews?tab=manage";
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) flash(to, "err", "Unknown cycle.");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("review_cycle_open", { p_cycle: id.data });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/reviews");
  flash(to, "ok", `Cycle opened — ${data} review forms sent out.`);
}

export async function closeCycle(fd: FormData) {
  await requireContext();
  const to = "/growth/reviews?tab=manage";
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) flash(to, "err", "Unknown cycle.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("review_cycle_close", { p_cycle: id.data });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/reviews");
  flash(to, "ok", "Cycle closed. Everyone can now see their own summary.");
}

export async function submitReviewForm(fd: FormData) {
  await requireContext();
  const id = uuid.safeParse(fd.get("id"));
  const to = id.success ? `/growth/reviews?form=${id.data}` : "/growth/reviews";
  if (!id.success) flash("/growth/reviews", "err", "Unknown form.");
  const ratings: Record<string, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("q_")) ratings[k.slice(2)] = Number(v);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("review_submit", {
    p_assignment: id.data,
    p_ratings: ratings,
    p_strengths: String(fd.get("strengths") ?? ""),
    p_improvements: String(fd.get("improvements") ?? ""),
  });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/reviews");
  flash("/growth/reviews", "ok", "Thanks — your review is submitted.");
}

// ---------- Training ----------
export async function saveTraining(fd: FormData) {
  const ctx = await requireContext();
  const to = back(fd, "/growth/training");
  const p = z
    .object({
      id: uuid.optional(),
      employee_id: uuid.optional(),
      title: z.string().trim().min(3, "Title: at least 3 characters").max(160),
      provider: z.string().trim().max(120).optional(),
      kind: z.enum(["COURSE", "WORKSHOP", "CERTIFICATION", "INTERNAL", "ON_THE_JOB"]),
      status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DROPPED"]),
      started_on: date.optional(),
      completed_on: date.optional(),
      hours: z.coerce.number().min(0).max(2000).optional(),
      certificate_url: z.string().trim().url().startsWith("https://", "Certificate link must start with https://").optional(),
      notes: z.string().trim().max(1000).optional(),
    })
    .safeParse(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, blank(v)])));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the training record.");
  const d = p.data;
  if (d.status === "COMPLETED" && !d.completed_on) flash(to, "err", "Add the completion date.");
  const sb = await supabaseServer();
  const row = {
    title: d.title,
    provider: d.provider ?? null,
    kind: d.kind,
    status: d.status,
    started_on: d.started_on ?? null,
    completed_on: d.completed_on ?? null,
    hours: d.hours ?? null,
    certificate_url: d.certificate_url ?? null,
    notes: d.notes ?? null,
  };
  const { error } = d.id
    ? await sb.from("training_records").update(row).eq("id", d.id)
    : await sb
        .from("training_records")
        .insert({ ...row, org_id: ctx.org_id, employee_id: d.employee_id ?? ctx.employee_id, created_by: ctx.employee_id });
  if (error) flash(to, "err", dbMessage(error, "You can't record training for this person (verified records are locked)."));
  revalidatePath("/growth/training");
  flash(to, "ok", d.id ? "Training updated." : "Training recorded.");
}

export async function verifyTraining(fd: FormData) {
  await requireContext();
  const to = back(fd, "/growth/training");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) flash(to, "err", "Unknown record.");
  const sb = await supabaseServer();
  const { error } = await sb.rpc("training_verify", { p_id: id.data });
  if (error) flash(to, "err", dbMessage(error));
  revalidatePath("/growth/training");
  flash(to, "ok", "Training verified.");
}
