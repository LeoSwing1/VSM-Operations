"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash } from "@/lib/actions";
import { buildRun } from "@/lib/reports/worker";
import { REPORT_TYPES } from "@/lib/reports/build";

const type = z.string().refine((t) => t in REPORT_TYPES, "Unknown report");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Run a report now. Access is checked by report_request(); the file is built straight away. */
export async function runReport(fd: FormData) {
  await requireContext();
  const p = z.object({ report_type: type, format: z.enum(["XLSX", "PDF", "CSV"]), from: date, to: date }).safeParse(Object.fromEntries(fd));
  if (!p.success) flash("/reports", "err", "Pick a report and dates.");
  const sb = await supabaseServer();
  const { data: id, error } = await sb.rpc("report_request", {
    p_type: p.data.report_type,
    p_format: p.data.format,
    p_start: p.data.from,
    p_end: p.data.to,
  });
  if (error || !id) flash("/reports", "err", dbMessage(error, "You don't have access to this report."));
  const { data: run } = await sb.from("report_runs").select("id,org_id,report_type,format,period_start,period_end").eq("id", id).single();
  const ok = run ? await buildRun(run) : false;
  revalidatePath("/reports");
  flash(
    `/reports?run=${id}`,
    ok ? "ok" : "err",
    ok ? "Report ready — download it below." : "The report failed to build. Try again, or check Operations Center → Recent app errors.",
  );
}

export async function saveSchedule(fd: FormData) {
  const ctx = await requireContext();
  const to = "/reports?tab=schedules";
  const p = z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(3, "Name: at least 3 characters").max(120),
      report_type: type,
      format: z.enum(["XLSX", "PDF", "CSV"]),
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
      weekday: z.coerce.number().int().min(1).max(7).optional(),
      month_day: z.coerce.number().int().min(1).max(28).optional(),
      hour_local: z.coerce.number().int().min(0).max(23),
    })
    .safeParse(Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== "recipients" && v !== "")));
  if (!p.success) flash(to, "err", p.error.issues[0]?.message ?? "Check the schedule.");
  const recipients = fd
    .getAll("recipients")
    .map(String)
    .filter((r) => /^[0-9a-f-]{36}$/.test(r));
  if (!recipients.length) flash(to, "err", "Pick at least one recipient.");
  const row = {
    name: p.data.name,
    format: p.data.format,
    frequency: p.data.frequency,
    weekday: p.data.frequency === "WEEKLY" ? (p.data.weekday ?? 1) : null,
    month_day: p.data.frequency === "MONTHLY" ? (p.data.month_day ?? 1) : null,
    hour_local: p.data.hour_local,
    recipients,
  };
  const sb = await supabaseServer();
  const { error } = p.data.id
    ? await sb.from("report_schedules").update(row).eq("id", p.data.id)
    : await sb
        .from("report_schedules")
        .insert({ ...row, org_id: ctx.org_id, report_type: p.data.report_type, created_by: ctx.employee_id });
  if (error) flash(to, "err", dbMessage(error, "You can't schedule this report."));
  revalidatePath("/reports");
  flash(to, "ok", "Schedule saved. Recipients get an in-app notification and an email with a download link — never the figures.");
}

export async function toggleSchedule(fd: FormData) {
  await requireContext();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) flash("/reports?tab=schedules", "err", "Unknown schedule.");
  const sb = await supabaseServer();
  const { data: s } = await sb.from("report_schedules").select("active").eq("id", id.data).maybeSingle();
  const { error } = await sb.from("report_schedules").update({ active: !s?.active }).eq("id", id.data);
  if (error) flash("/reports?tab=schedules", "err", dbMessage(error));
  revalidatePath("/reports");
  flash("/reports?tab=schedules", "ok", s?.active ? "Schedule paused." : "Schedule resumed.");
}

export async function deleteSchedule(fd: FormData) {
  await requireContext();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) flash("/reports?tab=schedules", "err", "Unknown schedule.");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("report_schedules").delete().eq("id", id.data).select("id");
  if (error || !data?.length) flash("/reports?tab=schedules", "err", dbMessage(error, "You can't delete this schedule."));
  revalidatePath("/reports");
  flash("/reports?tab=schedules", "ok", "Schedule deleted. Past files stay available.");
}
