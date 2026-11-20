"use server";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

const BACK = "/settings/attendance";
const Time = z.string().regex(/^\d{2}:\d{2}$/);

const Shift = z.object({
  name: z.string().trim().min(2).max(60),
  start_time: Time, end_time: Time,
  grace_minutes: z.coerce.number().int().min(0).max(180),
  half_day_minutes: z.coerce.number().int().min(30).max(1440),
  full_day_minutes: z.coerce.number().int().min(60).max(1440),
  weekly_offs: z.array(z.coerce.number().int().min(0).max(6)).max(6),
}).refine((s) => s.end_time > s.start_time, "End time must be after start time")
  .refine((s) => s.half_day_minutes < s.full_day_minutes, "Half-day minutes must be less than full-day minutes");

export async function saveShift(fd: FormData) {
  const ctx = await requirePerm("attendance.manage");
  const p = Shift.safeParse({
    name: str(fd, "name"), start_time: str(fd, "start_time").slice(0, 5), end_time: str(fd, "end_time").slice(0, 5),
    grace_minutes: str(fd, "grace_minutes") || 10, half_day_minutes: Math.round(Number(str(fd, "half_day_hours") || 4) * 60),
    full_day_minutes: Math.round(Number(str(fd, "full_day_hours") || 8) * 60), weekly_offs: fd.getAll("weekly_offs").map(String),
  });
  if (!p.success) flash(BACK, "err", p.error.issues[0]?.message ?? "Check the shift.");
  const sb = await supabaseServer();
  const id = optStr(fd, "id");
  const { error } = id ? await sb.from("shifts").update(p.data).eq("id", id) : await sb.from("shifts").insert({ ...p.data, org_id: ctx.org_id });
  if (error) flash(BACK, "err", dbMessage(error, "A shift with that name already exists."));
  await sb.rpc("log_audit", { p_action: id ? "shift.updated" : "shift.created", p_entity: "shift", p_entity_id: id ?? p.data.name, p_metadata: p.data });
  flash(BACK, "ok", `Shift saved. Attendance for everyone on “${p.data.name}” now uses these rules.`);
}

export async function addHoliday(fd: FormData) {
  const ctx = await requirePerm("attendance.manage");
  const date = str(fd, "holiday_date"), name = str(fd, "name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || name.length < 2) flash(BACK, "err", "Pick a date and give the holiday a name.");
  const sb = await supabaseServer();
  const { error } = await sb.from("holidays").insert({ org_id: ctx.org_id, holiday_date: date, name });
  if (error) flash(BACK, "err", dbMessage(error, "There's already a holiday on that date."));
  await sb.rpc("log_audit", { p_action: "holiday.added", p_entity: "holiday", p_entity_id: date, p_metadata: { name } });
  flash(`${BACK}?year=${date.slice(0, 4)}`, "ok", "Holiday added.");
}

export async function removeHoliday(fd: FormData) {
  await requirePerm("attendance.manage");
  const sb = await supabaseServer();
  const { data, error } = await sb.from("holidays").delete().eq("id", str(fd, "id")).select("holiday_date, name");
  if (error || !data?.length) flash(BACK, "err", dbMessage(error, "Couldn't remove that holiday."));
  await sb.rpc("log_audit", { p_action: "holiday.removed", p_entity: "holiday", p_entity_id: data[0]!.holiday_date, p_metadata: { name: data[0]!.name } });
  flash(BACK, "ok", "Holiday removed.");
}
