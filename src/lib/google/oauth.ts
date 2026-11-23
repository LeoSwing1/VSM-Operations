import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/integrations/calendar-crypto";

export const GOOGLE_SCOPES = {
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.file",
  gmail: "https://www.googleapis.com/auth/gmail.send",
} as const;
export type GoogleService = keyof typeof GOOGLE_SCOPES;

export function googleClient() {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  return id && secret && process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ? { id, secret } : null;
}

export interface GoogleConnection {
  id: string;
  org_id: string;
  employee_id: string;
  account_email: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  scopes: string[];
}

export const hasScope = (c: Pick<GoogleConnection, "scopes">, s: GoogleService) => c.scopes.includes(GOOGLE_SCOPES[s]);

export async function googleConnectionFor(employeeId: string): Promise<GoogleConnection | null> {
  const { data } = await supabaseAdmin()
    .from("calendar_provider_connections")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("provider", "GOOGLE")
    .maybeSingle();
  return (data as GoogleConnection | null) ?? null;
}

/** A valid access token for this connection, refreshing (and re-encrypting) it when it is about to expire. */
export async function googleAccessToken(c: GoogleConnection): Promise<string> {
  if (c.expires_at && Date.parse(c.expires_at) > Date.now() + 120_000) return decryptToken(c.access_token_enc);
  const client = googleClient();
  if (!client) throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / CALENDAR_TOKEN_ENCRYPTION_KEY).");
  if (!c.refresh_token_enc) throw new Error("Google access expired — reconnect Google in Settings → Integrations → Google.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: decryptToken(c.refresh_token_enc),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google token refresh failed${j.error ? ` (${j.error})` : ""} — reconnect Google.`);
  const expires = new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin()
    .from("calendar_provider_connections")
    .update({
      access_token_enc: encryptToken(j.access_token),
      refresh_token_enc: j.refresh_token ? encryptToken(j.refresh_token) : c.refresh_token_enc,
      expires_at: expires,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", c.id);
  c.access_token_enc = encryptToken(j.access_token);
  c.expires_at = expires;
  return j.access_token;
}

/** Fetch against a Google API with the connection's token. Throws with Google's error message on failure. */
export async function googleFetch(c: GoogleConnection, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await googleAccessToken(c);
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    let detail = "";
    try {
      detail = ((await r.clone().json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* not json */
    }
    throw new Error(`Google API ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return r;
}
