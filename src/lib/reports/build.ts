import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { csvCell } from "./csv";
import { makeXlsx } from "./workbook";

export type ReportFormat = "XLSX" | "PDF" | "CSV";
export interface ReportData {
  title: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  notes?: string[];
  period_start: string;
  period_end: string;
  type: string;
}

export const REPORT_TYPES: Record<string, { label: string; hint: string; perm: string }> = {
  ATTENDANCE_SUMMARY: {
    label: "Attendance summary",
    hint: "Days present, hours, missing clock-outs, leave and pending corrections per person",
    perm: "attendance.manage",
  },
  TASK_DELIVERY: {
    label: "Task delivery",
    hint: "Completed tasks, on-time %, quality and overdue work per person",
    perm: "reports.view_org",
  },
  CRM_FUNNEL: { label: "CRM funnel", hint: "New leads by source and how far they got, with win rate", perm: "crm.view_all" },
  PNL_MONTHLY: {
    label: "Profit & loss (management)",
    hint: "Invoiced, fees, expenses, payroll total and operating result",
    perm: "finance.view",
  },
  SCHOLARS_ADMISSIONS: {
    label: "VSM Scholars admissions",
    hint: "Enquiries, enrolments, conversion and fees per course",
    perm: "scholars.view",
  },
  KPI_SUMMARY: { label: "KPI summary", hint: "Every KPI value vs target for the month", perm: "performance.view_all" },
};

/** Header row + data rows, numbers kept as numbers. */
export function reportRows(d: ReportData): (string | number | boolean | null)[][] {
  return [
    d.columns,
    ...d.rows.map((r) => r.map((v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v))),
  ];
}

export function reportFileName(d: ReportData, ext: string) {
  const slug = d.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug}_${d.period_start}_${d.period_end}.${ext}`;
}

const latin = (v: unknown) =>
  String(v ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

async function pdfTable(d: ReportData, org: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.title} ${d.period_start} to ${d.period_end}`);
  doc.setProducer("VSM Growth Operations");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842,
    H = 595,
    M = 32,
    size = 8,
    rowH = 14;
  const cols = d.columns.length || 1;
  // Column widths from content length, capped so wide text columns don't squeeze numbers.
  const rows = reportRows(d);
  const want = d.columns.map((_, i) => Math.min(32, Math.max(6, ...rows.slice(0, 200).map((r) => latin(r[i]).length))));
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => ((W - 2 * M) * w) / total);
  const fit = (s: string, w: number, f = font) => {
    let t = s;
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -2) + "…".replace("…", ".");
    return t;
  };
  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;
  const header = () => {
    page.drawText(latin(d.title), { x: M, y: y - 14, size: 16, font: bold, color: rgb(0.06, 0.06, 0.07) });
    page.drawText(
      latin(`${org} | ${d.period_start} to ${d.period_end} | generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`),
      {
        x: M,
        y: y - 28,
        size: 8,
        font,
        color: rgb(0.42, 0.42, 0.4),
      },
    );
    y -= 46;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.14, 0.19, 0.25) });
    let x = M;
    d.columns.forEach((c, i) => {
      page.drawText(fit(latin(c), widths[i]!, bold), { x: x + 2, y: y, size, font: bold, color: rgb(1, 1, 1) });
      x += widths[i]!;
    });
    y -= rowH;
  };
  header();
  rows.slice(1).forEach((r, ri) => {
    if (y < M + 20) {
      page.drawText(`Page ${pageNo}`, { x: W - M - 40, y: M - 12, size: 7, font, color: rgb(0.42, 0.42, 0.4) });
      page = doc.addPage([W, H]);
      pageNo++;
      y = H - M;
      header();
    }
    if (ri % 2) page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.96, 0.96, 0.95) });
    let x = M;
    for (let i = 0; i < cols; i++) {
      const v = r[i];
      const s = typeof v === "number" ? v.toLocaleString("en-IN") : latin(v);
      const t = fit(s, widths[i]!);
      const tx = typeof v === "number" ? x + widths[i]! - font.widthOfTextAtSize(t, size) - 3 : x + 2;
      page.drawText(t, { x: tx, y, size, font, color: rgb(0.06, 0.06, 0.07) });
      x += widths[i]!;
    }
    y -= rowH;
  });
  if (rows.length === 1) {
    page.drawText("No data for this period.", { x: M, y, size: 9, font, color: rgb(0.42, 0.42, 0.4) });
    y -= rowH;
  }
  for (const n of d.notes ?? []) {
    y -= 6;
    page.drawText(fit(latin(n), W - 2 * M), { x: M, y, size: 7.5, font, color: rgb(0.42, 0.42, 0.4) });
    y -= 10;
  }
  page.drawText(`Page ${pageNo}`, { x: W - M - 40, y: M - 12, size: 7, font, color: rgb(0.42, 0.42, 0.4) });
  return doc.save();
}

/** Turn report data into a downloadable file. */
export async function reportFile(
  d: ReportData,
  format: ReportFormat,
  org = "VSM Growth Operations",
): Promise<{ body: Uint8Array; contentType: string; ext: string }> {
  if (format === "CSV")
    return {
      body: new TextEncoder().encode(
        "\uFEFF" +
          reportRows(d)
            .map((r) => r.map(csvCell).join(","))
            .join("\r\n"),
      ),
      contentType: "text/csv; charset=utf-8",
      ext: "csv",
    };
  if (format === "PDF") return { body: await pdfTable(d, org), contentType: "application/pdf", ext: "pdf" };
  const rows = reportRows(d);
  if (d.notes?.length) rows.push([], ...d.notes.map((n) => [n]));
  return { body: makeXlsx(d.title, rows), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
}
