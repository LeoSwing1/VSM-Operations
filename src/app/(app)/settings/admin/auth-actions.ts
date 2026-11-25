"use server";
import { appUrl } from "@/lib/app-url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";

export type TestState = { ok: boolean; message: string } | null;
async function sa() {
  const ctx = await requireContext();
  if (ctx.role !== "SUPER_ADMIN") throw new Error("Super Admin only");
  return ctx;
}

/** Tries a sign-in with a throw-away client: proves the credentials work without touching your own session. */
export async function testLogin(_p: TestState, fd: FormData): Promise<TestState> {
  await sa();
  const p = z
    .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8) })
    .safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) return { ok: false, message: "Enter an email and password." };
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const t = Date.now();
  const { data, error } = await client.auth.signInWithPassword(p.data);
  if (error) return { ok: false, message: `Sign-in failed: ${error.message} (${Date.now() - t} ms)` };
  const { data: emp } = await supabaseAdmin()
    .from("employees")
    .select("full_name, employee_code, role, status")
    .eq("user_id", data.user.id)
    .maybeSingle();
  await client.auth.signOut();
  const sb = await supabaseServer();
  await sb.rpc("log_audit", { p_action: "auth.login_tested", p_entity: "auth", p_entity_id: p.data.email, p_metadata: { ok: true } });
  if (!emp)
    return { ok: false, message: `Password is correct, but this login isn't linked to an employee profile (${Date.now() - t} ms).` };
  return {
    ok: true,
    message: `✓ Login works: ${emp.full_name} · ${emp.employee_code} · ${emp.role} · ${emp.status} (${Date.now() - t} ms). Test session signed out.`,
  };
}

/** Sends a real reset email to the Super Admin's own inbox, through the same path employees use. */
export async function testResetEmail(_p: TestState, _fd: FormData): Promise<TestState> {
  const ctx = await sa();
  const redirectTo = `${appUrl()}/auth/callback?next=/login/reset`;
  const t = Date.now();
  try {
    const provider = await getProvider();
    if (provider && process.env.EMAIL_FROM) {
      const { data, error } = await supabaseAdmin().auth.admin.generateLink({
        type: "recovery",
        email: ctx.email,
        options: { redirectTo },
      });
      if (error || !data.properties?.action_link) throw error ?? new Error("no link");
      await provider.send({
        from: process.env.EMAIL_FROM,
        to: ctx.email,
        subject: "VSM Ops — password reset test",
        refId: `reset-test-${Date.now()}`,
        text: `This is a test of the password reset email. If you want to reset your password, use: ${data.properties.action_link}`,
        html: `<p>This is a test of the VSM Ops password reset email.</p><p><a href="${data.properties.action_link}">Reset my password</a> (only if you want to).</p>`,
      });
      return {
        ok: true,
        message: `Reset email sent to ${ctx.email} via ${provider.name} in ${Date.now() - t} ms. Check the inbox and spam folder.`,
      };
    }
    const sb = await supabaseServer();
    const { error } = await sb.auth.resetPasswordForEmail(ctx.email, { redirectTo });
    if (error) throw error;
    return { ok: true, message: `Reset email sent to ${ctx.email} via the Supabase mailer in ${Date.now() - t} ms.` };
  } catch (e) {
    return { ok: false, message: `Failed: ${(e as Error).message}` };
  }
}
