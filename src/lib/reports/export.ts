import "server-only";
import { NextResponse } from "next/server";
import { csvCell } from "./csv";
import { makePdf, makeXlsx } from "./workbook";
export function reportResponse(rows: (string | number | boolean | null | undefined)[][], base: string, format: string) {
  const f = ["csv", "xlsx", "pdf"].includes(format) ? format : "csv";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${base}-${stamp}.${f}"`,
  };
  if (f === "xlsx")
    return new NextResponse(makeXlsx(base, rows), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  if (f === "pdf")
    return new NextResponse(
      makePdf(
        base,
        rows.map((r) => r.map((v) => String(v ?? "")).join(" | ")),
      ),
      { headers: { ...headers, "Content-Type": "application/pdf" } },
    );
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new NextResponse("\uFEFF" + csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
