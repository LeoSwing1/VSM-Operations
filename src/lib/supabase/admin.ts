import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./server";

/**
 * Service-role client. BYPASSES RLS — use only in:
 *  - the public enquiry intake (calls the narrow ingest_enquiry RPC),
 *  - the email worker (cron, secret-protected),
 *  - inviting users, AFTER the caller's permission was verified server-side.
 */
export function supabaseAdmin() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
