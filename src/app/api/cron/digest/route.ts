import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { drainOutbox } from "@/lib/email/worker";
import { cronAuthorized, cronHeartbeat } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Daily: turns everyone's pending digest items into one summary email each, then sends. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { data: built, error } = await supabaseAdmin().rpc("build_daily_digests");
    if (error) throw new Error(error.message);
    const sent = await drainOutbox(100);
    await supabaseAdmin().rpc("ops_housekeeping"); // prune old error logs and rate-limit rows
    await cronHeartbeat(true);
    return NextResponse.json({ digests: built, ...sent });
  } catch (e) {
    await cronHeartbeat(false, (e as Error).message);
    return NextResponse.json({ error: "digest failed" }, { status: 500 });
  }
}
