import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = [/^\/login/, /^\/auth\//, /^\/api\/public\//, /^\/api\/cron\//, /^\/_next\//, /^\/favicon/];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();   // refreshes the session cookie
  const path = req.nextUrl.pathname;
  if (!user && !PUBLIC.some((r) => r.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(to);
  }
  if (user && path === "/login" && !req.nextUrl.searchParams.has("e")) {
    const to = req.nextUrl.clone(); to.pathname = "/dashboard"; to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico|webp)$).*)"] };
