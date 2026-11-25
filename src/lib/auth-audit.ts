import { supabaseAdmin } from "@/lib/supabase/admin";

/** Best-effort sign-in / sign-out / failed sign-in record in the audit log. Never blocks or breaks auth. */
export async function logAuthEvent(
  action: "auth.sign_in" | "auth.sign_out" | "auth.sign_in_failed",
  email: string,
  ip?: string,
  detail?: string,
) {
  if (!email || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await supabaseAdmin().rpc("audit_auth_event", { p_action: action, p_email: email, p_ip: ip ?? null, p_detail: detail ?? null });
  } catch {
    /* logging must never stop someone signing in */
  }
}
