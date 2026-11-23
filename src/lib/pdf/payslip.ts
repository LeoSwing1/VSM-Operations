import "server-only";
import { hr, money, MUTED, newDoc, text, VOLT } from "./kit";

export interface PayslipData {
  org: string;
  orgLine: string;
  period: string;
  issued: string;
  released: boolean;
  employee: {
    name: string;
    code: string;
    designation?: string | null;
    department?: string | null;
    joining?: string | null;
    pan?: string | null;
    uan?: string | null;
    bankLast4?: string | null;
  };
  payableDays: string;
  payment: string;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  employer: { label: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  reimbursement: number;
  net: number;
}

export async function payslipPdf(d: PayslipData): Promise<Uint8Array> {
  const k = await newDoc(`Payslip ${d.employee.code} ${d.period}`);
  const { M, W } = k;
  let y = k.H - M;
  text(k, "VSM.", M, y - 18, { size: 28, font: k.serif });
  k.page.drawCircle({ x: M + k.serif.widthOfTextAtSize("VSM", 28) + 5, y: y - 16, size: 3, color: VOLT });
  text(k, d.org, M, y - 34, { size: 9, color: MUTED });
  text(k, d.orgLine, M, y - 46, { size: 8, color: MUTED, maxWidth: 300 });
  text(k, "PAYSLIP", W - M, y - 12, { size: 9, font: k.bold, align: "right", color: MUTED });
  text(k, d.period, W - M, y - 28, { size: 13, font: k.bold, align: "right" });
  text(k, `Issued ${d.issued}${d.released ? "" : "  (not yet released)"}`, W - M, y - 42, { size: 8, align: "right", color: MUTED });
  y -= 64;
  hr(k, y);

  const info: [string, unknown][] = [
    ["Employee", d.employee.name],
    ["Employee ID", d.employee.code],
    ["Designation", d.employee.designation ?? "-"],
    ["Department", d.employee.department ?? "-"],
    ["Date of joining", d.employee.joining ?? "-"],
    ["Payable days", d.payableDays],
    ["PAN", d.employee.pan ?? "-"],
    ["UAN", d.employee.uan ?? "-"],
    ["Bank A/c", d.employee.bankLast4 ? `xxxx${d.employee.bankLast4}` : "-"],
  ];
  y -= 18;
  info.forEach(([l, v], i) => {
    const col = i % 3,
      row = Math.floor(i / 3);
    const x = M + col * ((W - 2 * M) / 3);
    text(k, l, x, y - row * 30, { size: 7, color: MUTED });
    text(k, v, x, y - row * 30 - 11, { size: 10, maxWidth: (W - 2 * M) / 3 - 8 });
  });
  y -= 3 * 30 + 6;
  hr(k, y);

  const colW = (W - 2 * M - 24) / 2;
  const table = (title: string, rows: { label: string; amount: number }[], x: number, top: number, total?: [string, number]) => {
    let yy = top - 16;
    text(k, title.toUpperCase(), x, yy, { size: 8, font: k.bold, color: MUTED });
    yy -= 16;
    if (!rows.length) {
      text(k, "None", x, yy, { size: 9, color: MUTED });
      yy -= 14;
    }
    for (const r of rows) {
      text(k, r.label, x, yy, { size: 9, maxWidth: colW - 90 });
      text(k, money(r.amount), x + colW, yy, { size: 9, align: "right" });
      yy -= 14;
    }
    if (total) {
      hr(k, yy + 6, x, x + colW);
      yy -= 8;
      text(k, total[0], x, yy, { size: 10, font: k.bold });
      text(k, money(total[1]), x + colW, yy, { size: 10, font: k.bold, align: "right" });
      yy -= 14;
    }
    return yy;
  };
  const a = table("Earnings", d.earnings, M, y, ["Gross earnings", d.gross]);
  const b = table("Deductions", d.deductions, M + colW + 24, y, ["Total deductions", d.totalDeductions]);
  y = Math.min(a, b) - 10;
  if (d.reimbursement > 0) {
    text(k, `Reimbursements added: ${money(d.reimbursement)}`, M, y, { size: 9 });
    y -= 16;
  }
  hr(k, y);
  y -= 34;
  text(k, "NET PAYABLE", W - M, y + 14, { size: 8, font: k.bold, align: "right", color: MUTED });
  text(k, money(d.net), W - M, y - 8, { size: 22, font: k.bold, align: "right" });
  text(k, `Payment: ${d.payment}`, M, y - 4, { size: 9, color: MUTED });
  y -= 36;
  if (d.employer.length) {
    hr(k, y);
    y -= 16;
    text(k, "EMPLOYER CONTRIBUTIONS (not deducted from your pay)", M, y, { size: 8, font: k.bold, color: MUTED });
    y -= 14;
    for (const r of d.employer) {
      text(k, r.label, M, y, { size: 9 });
      text(k, money(r.amount), M + colW, y, { size: 9, align: "right" });
      y -= 13;
    }
  }
  text(k, "Computer-generated payslip - no signature required. Queries: HR, VSM Growth.", M, M - 10, { size: 7, color: MUTED });
  return k.doc.save();
}
