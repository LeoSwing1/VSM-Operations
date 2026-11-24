import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { makeXlsxSheets } from "@/lib/reports/workbook";
import { monthBounds } from "@/lib/engines/time";

export const dynamic = "force-dynamic";

/** Monthly accountant pack (sales register, receipts, expenses, vendor payments, Scholars fees, payroll totals). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  const m = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: "Use ?month=YYYY-MM" }, { status: 400 });
  const { start, end } = monthBounds(`${m}-01`);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("accountant_pack", { p_org: ctx.org_id, p_start: start, p_end: end });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  const sheets = Object.entries(data as Record<string, (string | number | null)[][]>).map(([name, rows]) => ({ name, rows }));
  await sb.rpc("log_audit", {
    p_action: "reports.accountant_pack",
    p_entity: "organization",
    p_entity_id: ctx.org_id,
    p_metadata: { month: m },
  });
  return new NextResponse(makeXlsxSheets(sheets), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="accountant-pack_${m}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
