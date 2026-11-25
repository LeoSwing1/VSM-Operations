import { NextResponse, type NextRequest } from "next/server";
import { can, getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AREAS, areaFilter, areaOf, describeEvent, sourceLabel } from "@/lib/audit-labels";
import { csvCell } from "@/lib/engines/assets";

export const dynamic = "force-dynamic";
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Audit log CSV (same filters as the page, up to 20,000 rows). RLS limits it to people with audit.view. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  if (!can(ctx, "audit.view")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const sb = await supabaseServer();
  const area = AREAS.find((a) => a.key === sp.get("area"));
  const who = sp.get("who") ?? "";
  const rows: any[] = [];
  for (let page = 0; page < 20; page++) {
    let q = sb
      .from("audit_events")
      .select(
        "id, action, entity, entity_id, metadata, created_at, actor_employee_id, actor:employees!actor_employee_id(full_name, employee_code)",
      )
      .order("created_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (area) q = q.or(areaFilter(area));
    if (who === "system") q = q.is("actor_employee_id", null).or("metadata->>source.is.null,metadata->>source.neq.integration");
    else if (who === "integration") q = q.eq("metadata->>source", "integration");
    else if (/^[0-9a-f-]{36}$/.test(who)) q = q.eq("actor_employee_id", who);
    if (isDay(sp.get("from"))) q = q.gte("created_at", new Date(`${sp.get("from")}T00:00:00+05:30`).toISOString());
    if (isDay(sp.get("to")))
      q = q.lt("created_at", new Date(new Date(`${sp.get("to")}T00:00:00+05:30`).getTime() + 86_400_000).toISOString());
    const term = (sp.get("q") ?? "")
      .replace(/[%_,()*]/g, " ")
      .trim()
      .slice(0, 60);
    if (term) q = q.or(`action.ilike.%${term}%,entity.ilike.%${term}%,entity_id.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const lines = [
    ["When (IST)", "Who", "Employee ID", "Source", "What happened", "Area", "Action", "Record", "Record ID", "IP"].map(csvCell).join(","),
  ];
  for (const a of rows) {
    lines.push(
      [
        new Date(a.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
        a.actor?.full_name ?? "",
        a.actor?.employee_code ?? "",
        sourceLabel(a.metadata, !!a.actor_employee_id),
        describeEvent(a.action, a.entity, a.metadata),
        areaOf(a.action, a.entity)?.label ?? "Other",
        a.action,
        a.entity,
        a.entity_id,
        a.metadata?.ip ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await sb.rpc("log_audit", { p_action: "audit.export", p_entity: "audit_events", p_entity_id: null, p_metadata: { rows: rows.length } });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log_${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
