"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";
import { CATEGORIES, DEFAULT_MODE } from "@/lib/notification-categories";

const BACK = "/notifications/preferences";

export async function savePreferences(fd: FormData) {
  const ctx = await requireContext();
  const now = new Date().toISOString();
  const rows = CATEGORIES.flatMap((c) => {
    const email = String(fd.get(`email:${c.key}`) ?? DEFAULT_MODE(c.key));
    return [
      {
        org_id: ctx.org_id,
        employee_id: ctx.employee_id,
        category: c.key,
        channel: "EMAIL",
        mode: ["IMMEDIATE", "DIGEST", "MUTED"].includes(email) ? email : DEFAULT_MODE(c.key),
        updated_at: now,
      },
      {
        org_id: ctx.org_id,
        employee_id: ctx.employee_id,
        category: c.key,
        channel: "WHATSAPP",
        mode: fd.get(`wa:${c.key}`) === "on" ? "IMMEDIATE" : "MUTED",
        updated_at: now,
      },
      {
        org_id: ctx.org_id,
        employee_id: ctx.employee_id,
        category: c.key,
        channel: "PUSH",
        mode: fd.get(`push:${c.key}`) === "on" ? "IMMEDIATE" : "MUTED",
        updated_at: now,
      },
    ];
  });
  const sb = await supabaseServer();
  const { error } = await sb.from("notification_preferences").upsert(rows, { onConflict: "employee_id,category,channel" });
  if (error) flash(BACK, "err", dbMessage(error));
  flash(BACK, "ok", "Preferences saved. They apply to the next notification.");
}

const Phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .transform((v) => (/^[6-9]\d{9}$/.test(v) ? `+91${v}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a mobile number like 98765 43210 or +91 98765 43210"));

export async function saveWhatsApp(fd: FormData) {
  const ctx = await requireContext();
  if (fd.get("consent") !== "on") flash(BACK, "err", "Tick the consent box to receive WhatsApp messages.");
  const p = Phone.safeParse(str(fd, "phone"));
  if (!p.success) flash(BACK, "err", p.error.issues[0]?.message ?? "Invalid number.");
  const sb = await supabaseServer();
  const { error } = await sb.from("whatsapp_optins").upsert({
    employee_id: ctx.employee_id,
    org_id: ctx.org_id,
    phone_e164: p.data,
    opted_in: true,
    opted_in_at: new Date().toISOString(),
    opted_out_at: null,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", { p_action: "whatsapp.opt_in", p_entity: "employee", p_entity_id: ctx.employee_id, p_metadata: {} });
  flash(BACK, "ok", `WhatsApp updates on for ${p.data.replace(/(\+\d{2})\d+(\d{3})$/, "$1•••••$2")}. Choose which kinds below.`);
}

export async function stopWhatsApp() {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  await sb
    .from("whatsapp_optins")
    .update({ opted_in: false, opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("employee_id", ctx.employee_id);
  await sb.rpc("log_audit", { p_action: "whatsapp.opt_out", p_entity: "employee", p_entity_id: ctx.employee_id, p_metadata: {} });
  flash(BACK, "ok", "WhatsApp messages stopped.");
}

const Sub = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Called from the browser after the user grants notification permission. */
export async function registerPush(raw: unknown, userAgent: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireContext();
  const p = Sub.safeParse(raw);
  if (!p.success) return { ok: false, message: "This browser returned an invalid subscription." };
  const sb = await supabaseServer();
  const { error } = await sb.from("push_subscriptions").upsert(
    {
      org_id: ctx.org_id,
      employee_id: ctx.employee_id,
      endpoint: p.data.endpoint,
      p256dh: p.data.keys.p256dh,
      auth_secret: p.data.keys.auth,
      user_agent: userAgent.slice(0, 200),
      revoked_at: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, message: dbMessage(error, "Couldn't save this device.") };
  revalidatePath(BACK);
  return { ok: true, message: "Push notifications are on for this device." };
}

export async function removePush(fd: FormData) {
  await requireContext();
  const sb = await supabaseServer();
  await sb.from("push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", str(fd, "id"));
  flash(BACK, "ok", "Device removed.");
}
