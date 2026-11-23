import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Hands the signed-in user's short-lived ACCESS token to the browser for Realtime only.
 * - getUser() first: the session is verified with Supabase Auth, not just read from the cookie.
 * - Same-origin only, never cached. The refresh token stays in the HttpOnly cookie.
 */
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== req.nextUrl.origin) || (site && !["same-origin", "none"].includes(site))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json(
    { access_token: session.access_token, expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 600 },
    { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
  );
}
