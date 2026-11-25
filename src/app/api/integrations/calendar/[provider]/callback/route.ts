import { appUrl } from "@/lib/app-url";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/integrations/calendar-crypto";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params,
    p = provider.toLowerCase();
  if (p !== "google" && p !== "microsoft") return NextResponse.json({ error: "unsupported provider" }, { status: 404 });
  const state = req.nextUrl.searchParams.get("state"),
    cookie = req.cookies.get(`vsm_calendar_state_${p}`)?.value,
    code = req.nextUrl.searchParams.get("code");
  const nextCookie = req.cookies.get(`vsm_calendar_next_${p}`)?.value ?? "/calendar";
  const back = /^\/(?![/\\])/.test(nextCookie) ? nextCookie.split("?")[0]! : "/calendar";
  const fail = (msg: string) => NextResponse.redirect(new URL(`${back}?err=${encodeURIComponent(msg)}`, appUrl()));
  if (!state || !cookie || state !== cookie || !code) return fail("Calendar connection could not be verified.");
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  const google = p === "google",
    clientId = google ? (process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CALENDAR_CLIENT_ID) : process.env.MICROSOFT_CALENDAR_CLIENT_ID,
    secret = google
      ? (process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CALENDAR_CLIENT_SECRET)
      : process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  if (!clientId || !secret || !process.env.CALENDAR_TOKEN_ENCRYPTION_KEY)
    return fail("Calendar OAuth credentials or token encryption key are not configured.");
  const redirect = new URL(`/api/integrations/calendar/${p}/callback`, appUrl()).toString(),
    tokenUrl = google ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) return fail("Calendar provider rejected the authorisation.");
    const profileUrl = google
      ? "https://www.googleapis.com/oauth2/v2/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
    const profileRes = await fetch(profileUrl, { headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
    const profile = await profileRes.json();
    const email = google ? profile.email : (profile.mail ?? profile.userPrincipalName);
    if (!profileRes.ok || !email || (google && profile.email_verified !== true))
      return fail("Could not verify the connected calendar account.");
    const sb = supabaseAdmin();
    const { error } = await sb.from("calendar_provider_connections").upsert(
      {
        org_id: ctx.org_id,
        employee_id: ctx.employee_id,
        provider: google ? "GOOGLE" : "MICROSOFT",
        account_email: email,
        access_token_enc: encryptToken(token.access_token),
        refresh_token_enc: token.refresh_token ? encryptToken(token.refresh_token) : null,
        expires_at: new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000).toISOString(),
        scopes: String(token.scope ?? "")
          .split(" ")
          .filter(Boolean),
        sync_enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,employee_id,provider" },
    );
    if (error) return fail("Calendar credentials could not be stored securely.");
    const res = NextResponse.redirect(new URL(`${back}?ok=${encodeURIComponent("Google connected.")}`, appUrl()));
    res.cookies.set(`vsm_calendar_state_${p}`, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/integrations/calendar/${p}/callback`,
      maxAge: 0,
    });
    return res;
  } catch {
    return fail("Calendar connection failed. Please retry.");
  }
}
