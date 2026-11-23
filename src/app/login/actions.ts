"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const Creds = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(200) });

export async function signIn(fd: FormData) {
  const next = String(fd.get("next") ?? "/dashboard");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const parsed = Creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) redirect(`/login?err=${encodeURIComponent("Enter a valid email and password (8+ characters).")}`);
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  // Same message for unknown user / wrong password — no account enumeration.
  if (error)
    redirect(
      `/login?err=${encodeURIComponent(error.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Incorrect email or password.")}`,
    );
  redirect(safeNext);
}

export async function sendReset(fd: FormData) {
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  if (email.success) {
    const h = await headers();
    const origin = process.env.APP_URL ?? `https://${h.get("host")}`;
    const sb = await supabaseServer();
    await sb.auth.resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/callback?next=/login/reset` });
  }
  redirect(`/login?ok=${encodeURIComponent("If that email has an account, a reset link is on its way.")}`);
}

export async function setNewPassword(fd: FormData) {
  const pw = String(fd.get("password") ?? ""),
    confirm = String(fd.get("confirm") ?? "");
  if (pw.length < 10 || pw !== confirm)
    redirect(
      `/login/reset?err=${encodeURIComponent("Passwords must match and be at least 10 characters.")}${fd.get("forced") ? "&forced=1" : ""}`,
    );
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
  if (error) redirect(`/login/reset?err=${encodeURIComponent("Reset link expired. Request a new one.")}`);
  await sb.auth.signOut({ scope: "others" }); // revoke other sessions after a password change
  redirect(`/dashboard?ok=${encodeURIComponent("Password updated.")}`);
}
