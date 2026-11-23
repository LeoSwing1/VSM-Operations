"use server";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";

const BACK = "/settings/attendance/field";

export async function saveFieldSettings(fd: FormData) {
  const ctx = await requirePerm("attendance.manage");
  const p = z
    .object({
      geofence_mode: z.enum(["OFF", "WARN", "ENFORCE"]),
      selfie_mode: z.enum(["OFF", "OPTIONAL", "REQUIRED"]),
      offline_max_hours: z.coerce.number().int().min(1).max(48),
    })
    .safeParse({
      geofence_mode: str(fd, "geofence_mode"),
      selfie_mode: str(fd, "selfie_mode"),
      offline_max_hours: str(fd, "offline_max_hours") || 12,
    });
  if (!p.success) flash(BACK, "err", p.error.issues[0]?.message ?? "Check the form.");
  const sb = await supabaseServer();
  const { error } = await sb.from("attendance_settings").upsert({
    org_id: ctx.org_id,
    ...p.data,
    require_location: fd.get("require_location") === "on",
    allow_offline: fd.get("allow_offline") === "on",
    updated_by: ctx.employee_id,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: "attendance.field_settings_saved",
    p_entity: "organization",
    p_entity_id: ctx.org_id,
    p_metadata: p.data,
  });
  flash(BACK, "ok", "Field attendance rules saved. They apply to the next punch.");
}

const Office = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(300).optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(30).max(5000),
});

export async function saveOffice(fd: FormData) {
  const ctx = await requirePerm("attendance.manage");
  const p = Office.safeParse({
    name: fd.get("name"),
    address: fd.get("address") || undefined,
    latitude: fd.get("latitude"),
    longitude: fd.get("longitude"),
    radius_m: fd.get("radius_m") || 150,
  });
  if (!p.success) flash(BACK, "err", `Office: ${p.error.issues[0]?.message ?? "check the form"}`);
  const sb = await supabaseServer();
  const { error } = await sb
    .from("office_locations")
    .upsert({ org_id: ctx.org_id, ...p.data, is_active: true }, { onConflict: "org_id,name" });
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", `${p.data.name} saved (${p.data.radius_m} m radius).`);
}

export async function toggleOffice(fd: FormData) {
  await requirePerm("attendance.manage");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("office_locations")
    .update({ is_active: str(fd, "active") === "1" })
    .eq("id", str(fd, "id"));
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", "Office updated.");
}

export async function setRemoteAllowed(fd: FormData) {
  await requirePerm("people.manage");
  const sb = await supabaseServer();
  const { error } = await sb
    .from("employees")
    .update({ remote_allowed: str(fd, "allowed") === "1" })
    .eq("id", str(fd, "id"));
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", "Remote-work setting updated.");
}
