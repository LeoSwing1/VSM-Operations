import { appUrl } from "@/lib/app-url";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";
import { allow, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  // 5 reset emails per IP per hour, 3 per address — same reply either way (no account enumeration).
  if (email.success && (await allow("forgot-ip", clientIp(req), 5, 3600)) && (await allow("forgot-acct", email.data, 3, 3600))) {
    try {
      const origin = appUrl();
      const sb = await supabaseServer();
      await sb.auth.resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/callback?next=/login/reset` });
    } catch {
      /* same answer either way — no account enumeration */
    }
  }
  return go(req, msg("/login", "ok", "If that email has an account, a reset link is on its way."));
}
