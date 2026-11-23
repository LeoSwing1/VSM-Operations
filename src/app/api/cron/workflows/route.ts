import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized, cronHeartbeat } from "@/lib/cron";
import { drainWorkflowRuns, scanBusinessSla, escalateWorkflowApprovals } from "@/lib/workflows/worker";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sla = await scanBusinessSla();
    const escalations = await escalateWorkflowApprovals();
    const result = await drainWorkflowRuns(50);
    await cronHeartbeat(true);
    return NextResponse.json({ sla, escalations, ...result });
  } catch (e) {
    await cronHeartbeat(false, (e as Error).message);
    return NextResponse.json({ error: "workflow drain failed" }, { status: 500 });
  }
}
