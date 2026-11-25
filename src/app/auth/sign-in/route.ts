import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { go, msg, sameOrigin } from "@/lib/auth-forms";
import { allow, clientIp } from "@/lib/rate-limit";
import { logAuthEvent } from "@/lib/auth-audit";

const Creds = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().trim().min(8).max(200) }); // passwords can't start/end with a space; trims copy-paste

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return go(req, msg("/login", "err", "Please sign in from the VSM Ops page."));
  const fd = await req.formData();
  const next = String(fd.get("next") ?? "/dashboard");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const parsed = Creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return go(req, msg("/login", "err", "Enter a valid email and password (8+ characters)."));
  // Brute-force protection: 10 tries per IP and 5 per account every 15 minutes.
  const ip = clientIp(req);
  if (!(await allow("signin-ip", ip, 10, 900)) || !(await allow("signin-acct", parsed.data.email, 5, 900)))
    return go(req, msg("/login", "err", "Too many sign-in attempts. Wait 15 minutes, or reset your password."));
  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword(parsed.data);
    await logAuthEvent(
      error ? "auth.sign_in_failed" : "auth.sign_in",
      parsed.data.email,
      ip,
      error ? (error.code ?? "rejected") : undefined,
    );
    // Same message for unknown user / wrong password — no account enumeration.
    if (error)
      return go(
        req,
        msg(
          "/login",
          "err",
          error.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : error.code === "email_not_confirmed"
              ? "This login isn't activated yet. Ask HR to send you a new password from your profile."
              : "Incorrect email or password. If HR sent you several emails, use the password from the newest one.",
        ),
      );
  } catch {
    return go(req, msg("/login", "err", "Can't reach the sign-in service right now. Check your internet, or open Test connection."));
  }
  return go(req, safeNext);
}
