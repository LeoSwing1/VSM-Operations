import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Check = { name: string; ok: boolean; ms: number; detail: string };

async function timed(name: string, fn: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    return { name, ok: true, ms: Date.now() - t, detail: await fn() };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t, detail: (e as Error).message.slice(0, 160) };
  }
}

/** Public-safe connection checks: yes/no + latency only. Never returns keys, URLs with secrets or user data. */
export async function connectionChecks(): Promise<Check[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Promise.all([
    timed("Database", async () => {
      const { error } = await supabaseAdmin()
        .from("organizations")
        .select("id", { head: true, count: "exact" })
        .abortSignal(AbortSignal.timeout(5000));
      if (error) throw new Error("not reachable");
      return "connected";
    }),
    timed("Sign-in service", async () => {
      if (!url || !anon) throw new Error("not configured");
      const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon }, signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "online";
    }),
    timed("Realtime / live sync", async () => {
      if (!url) throw new Error("not configured");
      const r = await fetch(`${url}/realtime/v1/api/ping`, {
        headers: anon ? { apikey: anon } : {},
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }).catch(() => null);
      if (r && r.status < 500) return "online";
      throw new Error("not reachable");
    }),
    timed("Password-reset email", async () => {
      const provider = (
        process.env.EMAIL_PROVIDER ?? (process.env.BREVO_API_KEY ? "brevo" : process.env.RESEND_API_KEY ? "resend" : "")
      ).toLowerCase();
      if (!provider || !process.env.EMAIL_FROM) return "using Supabase built-in mailer (low hourly limit)";
      return `${provider} configured`;
    }),
  ]);
}
