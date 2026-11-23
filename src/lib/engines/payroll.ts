/**
 * Payroll engine — integer paise arithmetic, explainable line items.
 * Statutory deductions (PF, ESI, PT, TDS) are NOT computed here: they must be configured as
 * approved deductions after professional review. The engine says so in every breakdown.
 */
import { daysBetweenInclusive, maxDate, minDate } from "./time";

export interface Money {
  name: string;
  amount: number;
} // rupees
export interface Slab {
  min: number;
  pct: number;
} // score ≥ min → pct% of target

export interface SalaryStructure {
  id: string;
  pay_type: "FIXED" | "FIXED_PLUS_VARIABLE" | "INCENTIVE_ONLY";
  base_monthly: number;
  allowances: Money[];
  deductions: Money[];
  target_incentive: number;
  attendance_incentive: number;
}
export interface IncentivePolicy {
  id: string;
  slabs: Slab[];
  cap_amount: number | null;
  prorate: boolean;
}
export interface Snapshot {
  id: string;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  final_score: number | null;
}
export interface Adjustment {
  kind: "BONUS" | "REIMBURSEMENT" | "DEDUCTION";
  label: string;
  amount: number;
  reason: string;
}

export interface PayrollInput {
  periodStart: string;
  periodEnd: string;
  joiningDate: string;
  exitDate?: string | null;
  structure: SalaryStructure;
  policy: IncentivePolicy | null;
  snapshot: Snapshot | null;
  lopDays: number; // from attendance engine, within employed days
  attendanceIncentiveEligible: boolean;
  adjustments: Adjustment[];
}

export interface Line {
  label: string;
  amount: number;
  kind: "EARNING" | "DEDUCTION" | "INFO";
  note?: string;
}

export interface PayrollResult {
  periodDays: number;
  employedDays: number;
  lopDays: number;
  payableDays: number;
  base: number;
  allowances: number;
  incentive: number;
  attendanceIncentive: number;
  bonus: number;
  reimbursement: number;
  deductions: number;
  gross: number;
  net: number;
  lines: Line[];
  warnings: string[];
}

const P = (rupees: number) => Math.round(rupees * 100);
const R = (paise: number) => paise / 100;

export const DEFAULT_SLABS: Slab[] = [
  { min: 90, pct: 100 },
  { min: 80, pct: 75 },
  { min: 65, pct: 50 },
  { min: 50, pct: 25 },
];

export function validateSlabs(slabs: Slab[]): string[] {
  const e: string[] = [];
  if (!slabs.length) e.push("At least one slab is required");
  for (const s of slabs) {
    if (!(s.min >= 0 && s.min <= 100)) e.push(`Slab minimum ${s.min} must be 0–100`);
    if (!(s.pct >= 0 && s.pct <= 200)) e.push(`Slab payout ${s.pct}% must be 0–200`);
  }
  const mins = slabs.map((s) => s.min);
  if (new Set(mins).size !== mins.length) e.push("Slab minimums must be unique");
  return e;
}

export function slabPct(score: number, slabs: Slab[]): number {
  const match = [...slabs].sort((a, b) => b.min - a.min).find((s) => score >= s.min);
  return match?.pct ?? 0;
}

export function calculatePayroll(i: PayrollInput): PayrollResult {
  const warnings: string[] = [];
  const lines: Line[] = [];
  const periodDays = daysBetweenInclusive(i.periodStart, i.periodEnd);
  const empStart = maxDate(i.periodStart, i.joiningDate);
  const empEnd = i.exitDate ? minDate(i.periodEnd, i.exitDate) : i.periodEnd;
  const employedDays = empEnd < empStart ? 0 : daysBetweenInclusive(empStart, empEnd);
  const lopDays = Math.min(Math.max(0, i.lopDays), employedDays);
  const payableDays = employedDays - lopDays;

  if (employedDays < periodDays)
    lines.push({
      label: "Proration",
      amount: 0,
      kind: "INFO",
      note: `Employed ${employedDays} of ${periodDays} days (${empStart} → ${empEnd})`,
    });
  if (lopDays > 0) lines.push({ label: "Loss of pay", amount: 0, kind: "INFO", note: `${lopDays} unpaid day(s) from attendance/leave` });

  const factor = periodDays ? payableDays / periodDays : 0;
  const s = i.structure;

  const baseP = s.pay_type === "INCENTIVE_ONLY" ? 0 : Math.round(P(s.base_monthly) * factor);
  if (s.pay_type !== "INCENTIVE_ONLY")
    lines.push({ label: "Base salary", amount: R(baseP), kind: "EARNING", note: `${fmt(s.base_monthly)} × ${payableDays}/${periodDays}` });

  let allowP = 0;
  for (const a of s.allowances) {
    const v = Math.round(P(a.amount) * factor);
    allowP += v;
    lines.push({ label: a.name, amount: R(v), kind: "EARNING", note: `${fmt(a.amount)} × ${payableDays}/${periodDays}` });
  }

  // Performance-linked incentive: only from an APPROVED snapshot. Never guessed.
  let incP = 0;
  if (s.pay_type !== "FIXED" && s.target_incentive > 0) {
    if (!i.policy) {
      warnings.push("No incentive policy linked — incentive not paid");
      lines.push({ label: "Performance incentive", amount: 0, kind: "EARNING", note: "No incentive policy linked" });
    } else if (!i.snapshot || i.snapshot.status !== "APPROVED") {
      warnings.push("Performance snapshot not approved — incentive withheld until approved");
      lines.push({ label: "Performance incentive", amount: 0, kind: "EARNING", note: "Awaiting approved performance snapshot" });
    } else if (i.snapshot.final_score === null) {
      lines.push({ label: "Performance incentive", amount: 0, kind: "EARNING", note: "Insufficient performance data" });
    } else {
      const pct = slabPct(i.snapshot.final_score, i.policy.slabs);
      const empFactor = i.policy.prorate && periodDays ? employedDays / periodDays : 1;
      incP = Math.round(P(s.target_incentive) * (pct / 100) * empFactor);
      let note = `Score ${i.snapshot.final_score} → ${pct}% of ${fmt(s.target_incentive)}`;
      if (empFactor < 1) note += ` × ${employedDays}/${periodDays} employed`;
      if (i.policy.cap_amount !== null && incP > P(i.policy.cap_amount)) {
        incP = P(i.policy.cap_amount);
        note += ` (capped at ${fmt(i.policy.cap_amount)})`;
      }
      lines.push({ label: "Performance incentive", amount: R(incP), kind: "EARNING", note });
    }
  }

  let attP = 0;
  if (s.attendance_incentive > 0) {
    attP = i.attendanceIncentiveEligible && lopDays === 0 && employedDays === periodDays ? P(s.attendance_incentive) : 0;
    lines.push({
      label: "Attendance incentive",
      amount: R(attP),
      kind: "EARNING",
      note: attP ? "Full attendance, no loss of pay" : "Not eligible this period",
    });
  }

  let bonusP = 0,
    reimbP = 0,
    dedP = 0;
  for (const a of i.adjustments) {
    if (!(a.amount > 0)) {
      warnings.push(`Ignored non-positive adjustment "${a.label}"`);
      continue;
    }
    const v = P(a.amount);
    if (a.kind === "BONUS") bonusP += v;
    if (a.kind === "REIMBURSEMENT") reimbP += v;
    if (a.kind === "DEDUCTION") dedP += v;
    lines.push({ label: a.label, amount: R(v), kind: a.kind === "DEDUCTION" ? "DEDUCTION" : "EARNING", note: a.reason });
  }
  for (const d of s.deductions) {
    const v = P(d.amount);
    dedP += v;
    lines.push({ label: d.name, amount: R(v), kind: "DEDUCTION", note: "Approved recurring deduction" });
  }

  const grossP = baseP + allowP + incP + attP + bonusP;
  let netP = grossP + reimbP - dedP;
  if (netP < 0) {
    warnings.push("Deductions exceed earnings — net clamped to 0, review required");
    netP = 0;
  }

  lines.push({
    label: "Statutory deductions",
    amount: 0,
    kind: "INFO",
    note: "PF / ESI / PT / TDS are not auto-calculated. Configure them as approved deductions after professional review.",
  });

  return {
    periodDays,
    employedDays,
    lopDays,
    payableDays,
    base: R(baseP),
    allowances: R(allowP),
    incentive: R(incP),
    attendanceIncentive: R(attP),
    bonus: R(bonusP),
    reimbursement: R(reimbP),
    deductions: R(dedP),
    gross: R(grossP),
    net: R(netP),
    lines,
    warnings,
  };
}

export function fmt(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
