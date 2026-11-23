import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getContext } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  const { provider } = await params;
  const p = provider.toLowerCase();
  if (p !== "google" && p !== "microsoft") return NextResponse.json({ error: "unsupported provider" }, { status: 404 });
  const client =
    p === "google" ? (process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CALENDAR_CLIENT_ID) : process.env.MICROSOFT_CALENDAR_CLIENT_ID;
  if (!client) return NextResponse.json({ error: `${p} calendar OAuth is not configured` }, { status: 503 });
  const state = randomBytes(32).toString("base64url"),
    redirect = new URL(`/api/integrations/calendar/${p}/callback`, process.env.APP_URL ?? req.nextUrl.origin).toString();
  // Google: ?services=calendar,drive,gmail (incremental — previously granted scopes are kept).
  const wanted = (req.nextUrl.searchParams.get("services") ?? "calendar").split(",");
  const googleScopes = [
    "openid email profile",
    "https://www.googleapis.com/auth/calendar.events",
    ...(wanted.includes("drive") ? ["https://www.googleapis.com/auth/drive.file"] : []),
    ...(wanted.includes("gmail") ? ["https://www.googleapis.com/auth/gmail.send"] : []),
  ].join(" ");
  const scopes = p === "google" ? googleScopes : "openid email profile offline_access Calendars.ReadWrite User.Read";
  const nextPath = req.nextUrl.searchParams.get("next") ?? "/calendar";
  const auth = new URL(
    p === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  );
  auth.search = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: "code",
    scope: scopes,
    state,
    access_type: "offline",
    prompt: "consent",
    ...(p === "google" ? { include_granted_scopes: "true" } : {}),
  }).toString();
  const res = NextResponse.redirect(auth);
  res.cookies.set(`vsm_calendar_state_${p}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/api/integrations/calendar/${p}/callback`,
    maxAge: 600,
  });
  res.cookies.set(`vsm_calendar_next_${p}`, /^\/(?![/\\])/.test(nextPath) ? nextPath : "/calendar", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/api/integrations/calendar/${p}/callback`,
    maxAge: 600,
  });
  return res;
}
