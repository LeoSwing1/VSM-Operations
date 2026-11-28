import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Handles invite + password-recovery links:
 *  - ?code=…                     PKCE code exchange (links sent by Supabase itself)
 *  - ?token_hash=…&type=recovery our own branded emails (sent through Brevo)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  const next = sp.get("next") ?? "/dashboard";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const sb = await supabaseServer();
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safe, req.url));
  } else if (tokenHash && type) {
    // Never spend the token on a GET (mail scanners open links): show the confirm button instead.
    const to = new URL("/auth/confirm", req.url);
    to.searchParams.set("token_hash", tokenHash);
    to.searchParams.set("type", type);
    to.searchParams.set("next", safe);
    return NextResponse.redirect(to);
  }
  return NextResponse.redirect(
    new URL("/login?err=" + encodeURIComponent("That link is invalid or has expired — ask for a new one with “Forgot password”."), req.url),
  );
}
