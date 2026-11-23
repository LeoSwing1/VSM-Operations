import "server-only";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}

/** true = allowed. Fails open if the database is unreachable (sign-in must not break because the limiter did). */
export async function allow(kind: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().rpc("auth_rate_ok", {
      p_kind: kind,
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}
