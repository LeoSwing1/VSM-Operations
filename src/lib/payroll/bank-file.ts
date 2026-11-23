import { csvCell } from "@/lib/reports/csv";

export interface BankRow {
  name: string;
  account: string;
  ifsc: string;
  amount: number;
  email?: string | null;
  code: string;
  narration: string;
}

/** IFSC 5th character is always 0; account numbers 9–18 digits. */
export const validIfsc = (s: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s);
export const validAccount = (s: string) => /^\d{9,18}$/.test(s);
/** NEFT allows ≤ ₹2 lakh by IMPS on most banks; above that the file marks the row as RTGS/NEFT. */
export const modeFor = (amount: number) => (amount >= 200000 ? "RTGS" : "NEFT");

/**
 * Generic bulk-transfer CSV accepted by most Indian net-banking "bulk upload" screens after a one-time column mapping.
 * Bank-specific fixed layouts differ by bank and by account type — send us your bank's sample file to add one.
 */
export function genericBankCsv(rows: BankRow[]): string {
  const head = [
    "Beneficiary Name",
    "Beneficiary Account Number",
    "IFSC",
    "Amount",
    "Payment Mode",
    "Narration",
    "Beneficiary Email",
    "Employee ID",
  ];
  const body = rows.map((r) => [
    r.name.slice(0, 35),
    r.account,
    r.ifsc,
    r.amount.toFixed(2),
    modeFor(r.amount),
    r.narration.slice(0, 30),
    r.email ?? "",
    r.code,
  ]);
  // Account numbers as text so spreadsheets don't turn them into 1.23E+11.
  return [head, ...body].map((cols) => cols.map((c, i) => (i === 1 ? csvCell(`${c}`) : csvCell(c))).join(",")).join("\r\n") + "\r\n";
}
