import { NextResponse, type NextRequest } from "next/server";
import { drainOutbox } from "@/lib/email/worker";
import { cronAuthorized, cronHeartbeat } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Drains the email outbox (retries included). Protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await drainOutbox(50);
    await cronHeartbeat(true);
    return NextResponse.json(result);
  } catch (e) {
    await cronHeartbeat(false, (e as Error).message);
    return NextResponse.json({ error: "drain failed" }, { status: 500 });
  }
}
