import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized, cronHeartbeat } from "@/lib/cron";
import { processReports } from "@/lib/reports/worker";
import { drainOutbox } from "@/lib/email/worker";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 15 minutes: scheduled reports. Once a night (IST 01:00 hour) also refreshes automatic KPIs. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const out = await processReports(5);
    const hourIst = Number(
      new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()),
    );
    let kpis = 0;
    if (hourIst === 1 || req.nextUrl.searchParams.get("kpis") === "1") {
      const { data: orgs } = await supabaseAdmin().from("organizations").select("id");
      for (const o of orgs ?? []) {
        const { data } = await supabaseAdmin().rpc("kpi_refresh", { p_org: o.id });
        kpis += Number(data ?? 0);
      }
    }
    const mail = out.built ? await drainOutbox(50) : null;
    await cronHeartbeat(true);
    return NextResponse.json({ ...out, kpis, mail });
  } catch (e) {
    await cronHeartbeat(false, (e as Error).message);
    return NextResponse.json({ error: "reports failed" }, { status: 500 });
  }
}
