import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS, hardenCookie } from "@/lib/supabase/cookies";

const PUBLIC = [
  /^\/login/,
  /^\/sw\.js$/,
  /^\/manifest\.webmanifest$/,
  /^\/icons\//,
  /^\/status/,
  /^\/verify\//,
  /^\/offline/,
  /^\/api\/status/,
  /^\/vsm-logo/,
  /^\/auth\//,
  /^\/api\/public\//,
  /^\/api\/webhooks\//,
  /^\/api\/cron\//,
  /^\/_next\//,
  /^\/favicon/,
];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, hardenCookie(options)));
      },
    },
  });
  // getClaims() refreshes the session cookie when needed and verifies the JWT. With Supabase's asymmetric signing
  // keys it does that locally (no network call on every click); with the legacy secret it falls back to Auth.
  const path = req.nextUrl.pathname;
  /** Redirect, carrying any cookie changes made above (a refreshed token, or a dead session being cleared). */
  const redirect = (to: URL) => {
    const r = NextResponse.redirect(to);
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  let user: { id: string; user_metadata: Record<string, unknown> } | null = null;
  if (path === "/login" || path.startsWith("/login/")) {
    // Sign-in and password pages ask Supabase directly: a cookie can still hold an unexpired token for a session that
    // was ended (e.g. after "Email new password"). Trusting it locally sent people to "choose your password" without
    // ever showing the login form. A dead session's cookies are cleared here so the login form appears.
    const { data } = await supabase.auth.getUser();
    user = data.user ? { id: data.user.id, user_metadata: (data.user.user_metadata ?? {}) as Record<string, unknown> } : null;
    if (!user && req.cookies.getAll().some((c) => c.name.startsWith("sb-"))) await supabase.auth.signOut({ scope: "local" });
  } else {
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    user = claims?.sub ? { id: claims.sub, user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown> } : null;
  }
  if (!user && !PUBLIC.some((r) => r.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return redirect(to);
  }
  if (!user && path === "/login/reset") {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?err=${encodeURIComponent("Please sign in — use the temporary password from your email, or “Forgot password” for a reset link.")}`;
    return redirect(to);
  }
  // An admin set a temporary password → the employee must choose their own before doing anything else.
  if (user?.user_metadata?.must_change_password && !/^\/(login\/reset|auth\/|api\/|_next\/)/.test(path)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "password_change_required" }, { status: 403 });
    const to = req.nextUrl.clone();
    to.pathname = "/login/reset";
    to.search = "?forced=1";
    return redirect(to);
  }
  // Signed-in users skip the login page — EXCEPT when the app sent them there because their
  // account has no employee profile (?e=…). Redirecting those back to /dashboard caused a loop.
  // Also not when they asked for a reset link or there's a message to show (a used/expired link lands here).
  const qs = req.nextUrl.searchParams;
  if (user && path === "/login" && !qs.has("e") && !qs.has("forgot") && !qs.has("err") && !qs.has("ok")) {
    const to = req.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return redirect(to);
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|css|js|map|txt|mp4|webm)$).*)",
  ],
};
