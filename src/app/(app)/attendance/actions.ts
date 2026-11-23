"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
import { zonedInstant } from "@/lib/engines/time";

const Punch = z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]);

export interface PunchOptions {
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  /** ISO time the phone recorded the punch while offline (synced later). */
  offlineAt?: string | null;
  source?: "WEB" | "MOBILE";
}

/** Clock in / out / breaks. Location, selfie and offline time are optional — the database decides what is required. */
export async function punch(
  type: string,
  opts: PunchOptions = {},
  selfie?: FormData,
): Promise<{ ok: boolean; message: string; flagged?: boolean }> {
  const ctx = await requireContext();
  const t = Punch.safeParse(type);
  if (!t.success) return { ok: false, message: "Invalid action" };
  const sb = await supabaseServer();
  let selfiePath: string | null = null;
  const file = selfie?.get("selfie");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/webp", "image/png"].includes(file.type))
      return { ok: false, message: "Selfie must be a JPEG/PNG/WebP under 2 MB." };
    selfiePath = `${ctx.org_id}/${ctx.employee_id}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const up = await sb.storage.from("attendance-selfies").upload(selfiePath, file, { contentType: file.type, upsert: false });
    if (up.error) return { ok: false, message: "Couldn't upload the selfie. Try again." };
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const offlineAt = opts.offlineAt && !Number.isNaN(Date.parse(opts.offlineAt)) ? new Date(opts.offlineAt).toISOString() : null;
  const { data, error } = await sb.rpc("record_attendance_v2", {
    p_type: t.data,
    p_source: opts.source === "MOBILE" ? "MOBILE" : "WEB",
    p_lat: num(opts.lat),
    p_lng: num(opts.lng),
    p_accuracy: num(opts.accuracy) === null ? null : Math.round(num(opts.accuracy)!),
    p_selfie_path: selfiePath,
    p_offline_at: offlineAt,
  });
  if (error) {
    if (selfiePath) await sb.storage.from("attendance-selfies").remove([selfiePath]);
    return { ok: false, message: dbMessage(error) };
  }
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  const flag = (data as { flag?: string | null } | null)?.flag ?? null;
  const msg = {
    CLOCK_IN: "Clocked in. Have a great day.",
    CLOCK_OUT: "Clocked out. See you tomorrow.",
    BREAK_START: "Break started.",
    BREAK_END: "Welcome back.",
  }[t.data];
  return { ok: true, message: flag ? `${msg} Note: ${flag} — your manager will review it.` : msg, flagged: !!flag };
}

/** Settings the punch screen needs to know before punching (location / selfie requirements). */
export async function punchRequirements(): Promise<{
  geofence: string;
  selfie: string;
  requireLocation: boolean;
  offices: number;
  allowOffline: boolean;
}> {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: s }, { count }] = await Promise.all([
    sb
      .from("attendance_settings")
      .select("geofence_mode, selfie_mode, require_location, allow_offline")
      .eq("org_id", ctx.org_id)
      .maybeSingle(),
    sb.from("office_locations").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  return {
    geofence: s?.geofence_mode ?? "WARN",
    selfie: s?.selfie_mode ?? "OFF",
    requireLocation: !!s?.require_location,
    offices: count ?? 0,
    allowOffline: s?.allow_offline ?? true,
  };
}

const Correction = z.object({
  event_type: Punch,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(5).max(1000),
});

export async function requestCorrection(fd: FormData) {
  const ctx = await requireContext();
  const back = "/attendance";
  const p = Correction.safeParse({
    event_type: str(fd, "event_type"),
    date: str(fd, "date"),
    time: str(fd, "time"),
    reason: str(fd, "reason"),
  });
  if (!p.success) flash(back, "err", "Fill in the date, time and a reason (5+ characters).");
  const at = zonedInstant(p.data.date, p.data.time, ctx.timezone);
  if (at > new Date()) flash(back, "err", "Corrections can't be in the future.");
  const sb = await supabaseServer();
  const { error } = await sb.from("attendance_corrections").insert({
    org_id: ctx.org_id,
    employee_id: ctx.employee_id,
    event_type: p.data.event_type,
    requested_time: at.toISOString(),
    reason: p.data.reason,
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", "Correction requested. Your manager will review it.");
}
