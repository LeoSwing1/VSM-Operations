import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Vercel Cron (or any scheduler) sends Authorization: Bearer <CRON_SECRET>. */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** Heartbeat so the Integrations panel can prove the scheduler is actually running. */
export async function cronHeartbeat(ok: boolean, error?: string) {
  const sb = supabaseAdmin();
  const { data: orgs } = await sb.from("organizations").select("id");
  for (const o of orgs ?? []) await sb.rpc("record_integration_event", { p_org: o.id, p_key: "cron", p_ok: ok, p_error: error ?? null });
}
