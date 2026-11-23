import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, "/login");
  const fd = await req.formData();
  const pw = String(fd.get("password") ?? ""),
    confirm = String(fd.get("confirm") ?? "");
  const back = fd.get("forced") ? "/login/reset?forced=1" : "/login/reset";
  if (pw.length < 10 || pw !== confirm) return go(req, msg(back, "err", "Passwords must match and be at least 10 characters."));
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
  if (error)
    return go(
      req,
      msg(
        back,
        "err",
        error.message.includes("same") ? "Choose a password you haven't used before." : "Reset link expired. Request a new one.",
      ),
    );
  await sb.auth.signOut({ scope: "others" }); // revoke other sessions after a password change
  return go(req, msg("/dashboard", "ok", "Password updated."));
}
