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
  const {
    data: { user },
  } = await supabase.auth.getUser(); // refreshes the session cookie
  const path = req.nextUrl.pathname;
  if (!user && !PUBLIC.some((r) => r.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(to);
  }
  // An admin set a temporary password → the employee must choose their own before doing anything else.
  if (user?.user_metadata?.must_change_password && !/^\/(login\/reset|auth\/|api\/|_next\/)/.test(path)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "password_change_required" }, { status: 403 });
    const to = req.nextUrl.clone();
    to.pathname = "/login/reset";
    to.search = "?forced=1";
    return NextResponse.redirect(to);
  }
  // Signed-in users skip the login page — EXCEPT when the app sent them there because their
  // account has no employee profile (?e=…). Redirecting those back to /dashboard caused a loop.
  if (user && path === "/login" && !req.nextUrl.searchParams.has("e")) {
    const to = req.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico|webp)$).*)"] };
