import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SECRETS =
  /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk_[A-Za-z0-9]{10,}|xkeysib-[A-Za-z0-9-]{10,}|re_[A-Za-z0-9]{10,}|password=[^&\s]+)/g;
export const scrub = (s: string | null | undefined, max: number) => (s ? s.replace(SECRETS, "[redacted]").slice(0, max) : null);

export async function recordAppError(e: {
  kind: "SERVER" | "CLIENT" | "ACTION" | "CRON";
  path: string;
  method?: string;
  message: string;
  digest?: string | null;
  stack?: string | null;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  await supabaseAdmin()
    .from("app_errors")
    .insert({
      kind: e.kind,
      path: scrub(e.path, 300),
      method: e.method?.slice(0, 10) ?? null,
      message: scrub(e.message, 1000) ?? "unknown",
      digest: e.digest?.slice(0, 100) ?? null,
      stack: scrub(e.stack, 4000),
    });
}
