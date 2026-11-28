import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";

/** Spends the one-time token from /auth/confirm (POST only, so link scanners can't use it up). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const tokenHash = String(fd.get("token_hash") ?? "");
  const type = String(fd.get("type") ?? "recovery") as EmailOtpType;
  const nextRaw = String(fd.get("next") ?? "/login/reset");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/login/reset";
  if (!tokenHash || !["recovery", "invite", "magiclink", "email"].includes(type)) return go(req, "/login?forgot=1");
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.warn("[auth/verify]", error.code ?? error.name, error.message);
    return go(
      req,
      msg(
        "/login?forgot=1",
        "err",
        "That link has already been used or has expired (links work once, for 1 hour). Enter your email for a new one.",
      ),
    );
  }
  return go(req, next);
}
