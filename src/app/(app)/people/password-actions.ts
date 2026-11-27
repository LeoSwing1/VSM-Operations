"use server";
import { appUrl } from "@/lib/app-url";
import { render } from "@/lib/email/templates";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";
import { temporaryPassword } from "@/lib/passwords";
import { sendWelcome } from "@/lib/onboarding";

export type PwState = { ok: boolean; message: string; password?: string } | null;
const Id = z.string().uuid();

/** Loads the target only if the database says the caller may reset them (never the Super Admin, never someone at/above you). */
async function target(fd: FormData) {
  const ctx = await requirePerm("people.reset_password");
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return { ctx, err: "Unknown employee." } as const;
  const sb = await supabaseServer();
  const [{ data: allowed }, { data: e }] = await Promise.all([
    sb.rpc("can_reset_password", { p_target: id.data }),
    sb.from("employees").select("id, user_id, full_name, official_email").eq("id", id.data).maybeSingle(),
  ]);
  if (!allowed || !e)
    return {
      ctx,
      err: "You can't reset this person's password. The Super Admin and people at or above your level are protected.",
    } as const;
  return { ctx, sb, e } as const;
}

async function audit(sb: Awaited<ReturnType<typeof supabaseServer>>, action: string, id: string) {
  await sb.rpc("log_audit", { p_action: action, p_entity: "employee", p_entity_id: id, p_metadata: {} });
}

export async function sendResetLink(_p: PwState, fd: FormData): Promise<PwState> {
  const t = await target(fd);
  if ("err" in t) return { ok: false, message: t.err! };
  if (!t.e.user_id) return { ok: false, message: "No login yet — use “Send welcome email” first." };
  const redirectTo = `${appUrl()}/auth/callback?next=/login/reset`;
  const admin = supabaseAdmin();
  const provider = await getProvider();
  const from = process.env.EMAIL_FROM;
  try {
    if (provider && from) {
      // Our own provider (Brevo/Resend) — not limited by Supabase's built-in mailer.
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: t.e.official_email });
      const hashed = data?.properties?.hashed_token;
      if (error || !hashed) throw error ?? new Error("no link");
      const link = `${appUrl()}/auth/callback?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/login/reset`;
      const m = render("auth.reset_link", { name: t.e.full_name.split(" ")[0], email: t.e.official_email, link })!;
      await provider.send({
        from,
        to: t.e.official_email,
        subject: m.subject,
        html: m.html,
        text: m.text,
        refId: `reset-${t.e.id}-${Date.now()}`,
        tags: ["password-reset"],
      });
    } else {
      const { error } = await t.sb.auth.resetPasswordForEmail(t.e.official_email, { redirectTo });
      if (error) throw error;
    }
  } catch (e) {
    return { ok: false, message: `Couldn't send the reset email: ${(e as Error).message}` };
  }
  await audit(t.sb, "auth.password_reset_link_sent", t.e.id);
  return { ok: true, message: `Reset link emailed to ${t.e.official_email}.` };
}

export async function setTemporaryPassword(_p: PwState, fd: FormData): Promise<PwState> {
  const t = await target(fd);
  if ("err" in t) return { ok: false, message: t.err! };
  if (!t.e.user_id) return { ok: false, message: "No login yet — use “Send welcome email” first." };
  const password = temporaryPassword();
  const { error } = await supabaseAdmin().auth.admin.updateUserById(t.e.user_id!, {
    password,
    user_metadata: { must_change_password: true },
    email_confirm: true, // HR is emailing this address directly; an unconfirmed login would refuse to sign in
  });
  if (error) return { ok: false, message: `Couldn't set the password: ${error.message}` };
  await audit(t.sb, "auth.temporary_password_set", t.e.id);
  return {
    ok: true,
    message: `Temporary password for ${t.e.full_name}. They must change it at first sign-in. Share it privately — it is not stored anywhere.`,
    password,
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Welcome email (details + set-password link). Creates the login if the employee doesn't have one yet. */
export async function resendWelcome(_p: PwState, fd: FormData): Promise<PwState> {
  const t = await target(fd);
  if ("err" in t) return { ok: false, message: t.err! };
  try {
    await sendWelcome(t.e.id, "password");
  } catch (e) {
    return { ok: false, message: `Couldn't send: ${(e as Error).message}` };
  }
  await audit(t.sb, "employee.welcome_sent", t.e.id);
  return {
    ok: true,
    message: `Welcome email sent to ${t.e.official_email} with their Employee ID, login email and a temporary password (they change it at first sign-in).`,
  };
}

/** New temporary password, emailed to the employee AND shown once here. Must be changed at first sign-in. */
export async function emailNewPassword(_p: PwState, fd: FormData): Promise<PwState> {
  const t = await target(fd);
  if ("err" in t) return { ok: false, message: t.err! };
  if (!t.e.user_id) return { ok: false, message: "No login yet — use “Send welcome email” first." };
  const password = temporaryPassword();
  const { error } = await supabaseAdmin().auth.admin.updateUserById(t.e.user_id, {
    password,
    user_metadata: { must_change_password: true },
    email_confirm: true, // HR is emailing this address directly; an unconfirmed login would refuse to sign in
  });
  if (error) return { ok: false, message: `Couldn't set the password: ${error.message}` };
  const provider = await getProvider();
  let sent = false;
  if (provider && process.env.EMAIL_FROM) {
    const { render } = await import("@/lib/email/templates");
    const m = render("auth.new_password", { name: t.e.full_name, email: t.e.official_email, password })!;
    try {
      await provider.send({
        from: process.env.EMAIL_FROM,
        to: t.e.official_email,
        subject: m.subject,
        html: m.html,
        text: m.text,
        refId: `newpw-${t.e.id}-${Date.now()}`,
        tags: ["password"],
      });
      sent = true;
    } catch {
      sent = false;
    }
  }
  await audit(t.sb, "auth.temporary_password_emailed", t.e.id);
  return {
    ok: true,
    message: sent
      ? `New password emailed to ${t.e.official_email}. It is also shown below once. They must change it at first sign-in.`
      : `New password set (email isn't configured, so share it privately). They must change it at first sign-in.`,
    password,
  };
}
