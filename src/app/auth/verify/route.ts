import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";
import { passwordUpdateMessage } from "@/lib/password-errors";

/**
 * One step: check the one-time link AND save the new password in the same request (POST only, so mail scanners
 * that open links can't use the token up).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const tokenHash = String(fd.get("token_hash") ?? "");
  const type = String(fd.get("type") ?? "recovery") as EmailOtpType;
  const pw = String(fd.get("password") ?? ""),
    confirm = String(fd.get("confirm") ?? "");
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) || !["recovery", "invite", "magiclink", "email"].includes(type))
    return go(req, "/login?forgot=1");
  const back = `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
  // Check the password BEFORE spending the link, so a typo doesn't cost a new email.
  if (pw !== pw.trim()) return go(req, msg(back, "err", "Your password can't start or end with a space."));
  if (pw.length < 10 || pw !== confirm) return go(req, msg(back, "err", "Passwords must match and be at least 10 characters."));

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.session) {
    console.warn("[auth/verify] link", error?.code ?? error?.name, error?.message);
    return go(
      req,
      msg(
        "/login?forgot=1",
        "err",
        "That link has already been used or has expired (links work once, for 1 hour). Enter your email for a new one.",
      ),
    );
  }
  const { error: upd } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
  if (upd) {
    console.warn("[auth/verify] password", upd.code ?? upd.name, upd.message);
    // The link is spent but they are signed in now: let them pick another password on the normal page.
    return go(req, msg("/login/reset", "err", passwordUpdateMessage(upd as never)));
  }
  await sb.auth.signOut({ scope: "others" }); // a password change ends sessions on other devices
  return go(req, msg("/dashboard", "ok", "Password saved — you're signed in."));
}
