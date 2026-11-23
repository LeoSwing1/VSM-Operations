import { NextResponse, type NextRequest } from "next/server";
import { drainDeliveries } from "@/lib/delivery/worker";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Optional dedicated schedule for the delivery queue (the email cron also drains it). */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await drainDeliveries(200));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
