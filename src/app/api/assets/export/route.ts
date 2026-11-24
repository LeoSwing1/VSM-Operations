import { NextResponse, type NextRequest } from "next/server";
import { canAny, getContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { bookValue, categoryLabel, csvCell } from "@/lib/engines/assets";

export const dynamic = "force-dynamic";

/** Asset register as CSV. Purchase cost and book value are included only for people allowed to see them (RLS). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  if (!canAny(ctx, ["assets.view", "assets.manage"])) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const sb = await supabaseServer();
  const [{ data: rows, error }, { data: fin }] = await Promise.all([
    sb
      .from("assets")
      .select(
        "id, asset_tag, name, category, brand, model, serial_no, identifier, status, condition, location, warranty_until, issued_at, holder:employees!current_holder_id(full_name, employee_code)",
      )
      .order("asset_tag"),
    sb.from("asset_financials").select("asset_id, purchase_date, purchase_cost, vendor, invoice_ref, useful_life_months"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const money = new Map((fin ?? []).map((f) => [f.asset_id, f]));
  const showMoney = (fin ?? []).length > 0;
  const head = [
    "Tag",
    "Name",
    "Category",
    "Brand",
    "Model",
    "Serial no.",
    "IMEI/SIM/ref",
    "Status",
    "Condition",
    "Location",
    "Warranty until",
    "Holder",
    "Employee ID",
    "Issued at",
  ];
  if (showMoney) head.push("Purchase date", "Cost (INR)", "Vendor", "Invoice", "Life (months)", "Book value today (INR)");
  const lines = [head.map(csvCell).join(",")];
  for (const a of (rows ?? []) as any[]) {
    const f = money.get(a.id);
    const row: unknown[] = [
      a.asset_tag,
      a.name,
      categoryLabel(a.category),
      a.brand,
      a.model,
      a.serial_no,
      a.identifier,
      a.status,
      a.condition,
      a.location,
      a.warranty_until,
      a.holder?.full_name,
      a.holder?.employee_code,
      a.issued_at?.slice(0, 10),
    ];
    if (showMoney)
      row.push(
        f?.purchase_date,
        f?.purchase_cost,
        f?.vendor,
        f?.invoice_ref,
        f?.useful_life_months,
        f ? bookValue(f.purchase_cost, f.purchase_date, f.useful_life_months) : null,
      );
    lines.push(row.map(csvCell).join(","));
  }
  await sb.rpc("log_audit", {
    p_action: "assets.export",
    p_entity: "organization",
    p_entity_id: ctx.org_id,
    p_metadata: { rows: rows?.length ?? 0 },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="asset-register_${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
