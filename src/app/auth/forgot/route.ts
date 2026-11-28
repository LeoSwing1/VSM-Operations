import { appUrl } from "@/lib/app-url";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";
import { go, msg, sameOrigin } from "@/lib/auth-forms";
import { allow, clientIp } from "@/lib/rate-limit";

/**
 * Branded reset email through our own provider (Brevo) when it's configured; otherwise Supabase's built-in mail.
 * The link is a one-time recovery token from Supabase — we never email a password here.
 */
async function sendBranded(email: string): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !from) return false;
  const provider = await getProvider();
  if (!provider) return false;
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return true; // unknown address: say nothing, send nothing (no account enumeration)
  const { data: emp } = await admin
    .from("employees")
    .select("full_name")
    .ilike("official_email", email)
    .neq("status", "EXITED")
    .limit(1)
    .maybeSingle();
  const link = `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
  const m = render("auth.reset_link", { name: emp?.full_name?.split(" ")[0] ?? "", email, link })!;
  await provider.send({
    from,
    to: email,
    subject: m.subject,
    html: m.html,
    text: m.text,
    refId: `reset-${Date.now()}`,
    tags: ["password-reset"],
  });
  return true;
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  // 5 reset emails per IP per hour, 3 per address — same reply either way (no account enumeration).
  if (email.success && (await allow("forgot-ip", clientIp(req), 5, 3600)) && (await allow("forgot-acct", email.data, 3, 3600))) {
    try {
      if (!(await sendBranded(email.data))) {
        const sb = await supabaseServer();
        await sb.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl()}/auth/callback?next=/login/reset` });
      }
    } catch {
      /* same answer either way — no account enumeration */
    }
  }
  return go(req, msg("/login", "ok", "If that email has an account, a reset link is on its way."));
}
