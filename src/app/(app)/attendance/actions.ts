"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";

const Punch = z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]);

export async function punch(type: string): Promise<{ ok: boolean; message: string }> {
  await requireContext();
  const t = Punch.safeParse(type);
  if (!t.success) return { ok: false, message: "Invalid action" };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("record_attendance", { p_type: t.data, p_source: "WEB" });
  if (error) return { ok: false, message: dbMessage(error) };
  revalidatePath("/attendance"); revalidatePath("/dashboard");
  const msg = { CLOCK_IN: "Clocked in. Have a great day.", CLOCK_OUT: "Clocked out. See you tomorrow.", BREAK_START: "Break started.", BREAK_END: "Welcome back." }[t.data];
  return { ok: true, message: msg };
}

const Correction = z.object({
  event_type: Punch, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(5).max(1000),
});

export async function requestCorrection(fd: FormData) {
  const ctx = await requireContext();
  const back = "/attendance";
  const p = Correction.safeParse({ event_type: str(fd, "event_type"), date: str(fd, "date"), time: str(fd, "time"), reason: str(fd, "reason") });
  if (!p.success) flash(back, "err", "Fill in the date, time and a reason (5+ characters).");
  const at = zonedInstant(p.data.date, p.data.time, ctx.timezone);
  if (at > new Date()) flash(back, "err", "Corrections can't be in the future.");
  const sb = await supabaseServer();
  const { error } = await sb.from("attendance_corrections").insert({
    org_id: ctx.org_id, employee_id: ctx.employee_id, event_type: p.data.event_type, requested_time: at.toISOString(), reason: p.data.reason,
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Correction requested. Your manager will review it.");
}
