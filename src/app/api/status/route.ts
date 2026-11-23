import { NextResponse, type NextRequest } from "next/server";
import { allow, clientIp } from "@/lib/rate-limit";
import { connectionChecks } from "@/lib/status";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!(await allow("status", clientIp(req), 30, 60))) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const checks = await connectionChecks();
  return NextResponse.json(
    { ok: checks.every((c) => c.ok), checks, at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
