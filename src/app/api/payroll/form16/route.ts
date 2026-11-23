import { NextResponse, type NextRequest } from "next/server";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { csvCell } from "@/lib/reports/csv";

export const dynamic = "force-dynamic";

/** Form 16 / 24Q working data for a financial year (April–March): per employee, per month. For your CA — not a filed form. */
export async function GET(req: NextRequest) {
  await requirePerm("payroll.manage");
  const fy = Number(
    req.nextUrl.searchParams.get("fy") ?? (new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1),
  );
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return NextResponse.json({ error: "bad fy" }, { status: 400 });
  const from = `${fy}-04-01`,
    to = `${fy + 1}-03-31`;
  const sb = await supabaseServer();
  const { data: runs } = await sb
    .from("payroll_runs")
    .select("id, period_start")
    .gte("period_start", from)
    .lte("period_start", to)
    .in("status", ["PROCESSED", "PAID"]);
  const runMonth = new Map((runs ?? []).map((r) => [r.id, r.period_start.slice(0, 7)]));
  const [{ data: entries }, { data: stat }] = await Promise.all([
    runs?.length
      ? sb
          .from("payroll_entries")
          .select(
            "run_id, employee_id, gross_amount, net_amount, statutory, employee:employees!payroll_entries_employee_id_fkey(full_name, employee_code)",
          )
          .in("run_id", [...runMonth.keys()])
      : Promise.resolve({ data: [] as never[] }),
    sb.from("employee_statutory").select("employee_id, pan, uan, tax_regime"),
  ]);
  const st = new Map((stat ?? []).map((s) => [s.employee_id, s]));
  type Row = { name: string; code: string; months: Record<string, { gross: number; pf: number; esi: number; pt: number; tds: number }> };
  const by = new Map<string, Row>();
  for (const e of entries ?? []) {
    const emp = e.employee as unknown as { full_name: string; employee_code: string };
    const s = (e.statutory ?? {}) as { pf_employee?: number; esi_employee?: number; pt?: number; tds?: number };
    const row = by.get(e.employee_id) ?? { name: emp.full_name, code: emp.employee_code, months: {} };
    row.months[runMonth.get(e.run_id)!] = {
      gross: Number(e.gross_amount),
      pf: s.pf_employee ?? 0,
      esi: s.esi_employee ?? 0,
      pt: s.pt ?? 0,
      tds: s.tds ?? 0,
    };
    by.set(e.employee_id, row);
  }
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(fy, 3 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const head = [
    "Employee ID",
    "Name",
    "PAN",
    "UAN",
    "Regime",
    ...months.flatMap((m) => [`${m} Gross`, `${m} TDS`]),
    "Total gross",
    "Total PF (employee)",
    "Total ESI (employee)",
    "Total PT",
    "Total TDS",
  ];
  const lines = [head.map(csvCell).join(",")];
  for (const [empId, r] of by) {
    const s = st.get(empId);
    const tot = Object.values(r.months).reduce(
      (a, m) => ({ gross: a.gross + m.gross, pf: a.pf + m.pf, esi: a.esi + m.esi, pt: a.pt + m.pt, tds: a.tds + m.tds }),
      { gross: 0, pf: 0, esi: 0, pt: 0, tds: 0 },
    );
    lines.push(
      [
        r.code,
        r.name,
        s?.pan ?? "",
        s?.uan ?? "",
        s?.tax_regime ?? "NEW",
        ...months.flatMap((m) => [r.months[m]?.gross ?? 0, r.months[m]?.tds ?? 0]),
        tot.gross,
        tot.pf,
        tot.esi,
        tot.pt,
        tot.tds,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await sb.rpc("log_audit", {
    p_action: "payroll.form16_exported",
    p_entity: "payroll",
    p_entity_id: String(fy),
    p_metadata: { employees: by.size },
  });
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="form16-data-FY${fy}-${String(fy + 1).slice(2)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
