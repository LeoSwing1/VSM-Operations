import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";
import { passwordUpdateMessage } from "@/lib/password-errors";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const pw = String(fd.get("password") ?? ""),
    confirm = String(fd.get("confirm") ?? "");
  const back = fd.get("forced") ? "/login/reset?forced=1" : "/login/reset";
  if (pw !== pw.trim()) return go(req, msg(back, "err", "Your password can't start or end with a space."));
  if (pw.length < 10 || pw !== confirm) return go(req, msg(back, "err", "Passwords must match and be at least 10 characters."));
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
  if (error) {
    console.warn("[auth/new-password]", error.code ?? error.name, error.message);
    return go(req, msg(back, "err", passwordUpdateMessage(error as never)));
  }
  await sb.auth.signOut({ scope: "others" }); // revoke other sessions after a password change
  return go(req, msg("/dashboard", "ok", "Password updated."));
}
