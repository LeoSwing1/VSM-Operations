/**
 * Indian statutory payroll — pure functions, unit-tested (tests/block21.test.ts).
 * Defaults reflect rules in force in Nov 2026 (all editable per org in Payroll → Statutory settings):
 *  - EPF: 12% employee + 12% employer on PF wages (basic), wage ceiling ₹25,000/month from 17 Sep 2026.
 *    Employer share split: EPS 8.33% of wages up to the ceiling, the rest to EPF.
 *  - ESI: 0.75% employee + 3.25% employer of gross when gross ≤ ₹21,000; each share rounded UP to the next rupee.
 *  - TDS (new regime, FY 2026-27): ₹75,000 standard deduction; slabs 0/5/10/15/20/25/30% at 4/8/12/16/20/24 lakh;
 *    Section 87A rebate makes tax nil up to ₹12 lakh taxable, with marginal relief just above; 4% cess.
 *    Monthly TDS = annual projected tax ÷ 12. Old regime needs declarations → use the per-employee override.
 *  - PT: off by default (Uttar Pradesh levies none); enable with your state's slabs.
 */
export interface Slab {
  upto: number | null;
  rate: number;
}
export interface PtSlab {
  upto: number | null;
  amount: number;
}
export interface StatutorySettings {
  pf_enabled: boolean;
  pf_employee_rate: number;
  pf_employer_rate: number;
  pf_wage_ceiling: number;
  pf_restrict_to_ceiling: boolean;
  esi_enabled: boolean;
  esi_employee_rate: number;
  esi_employer_rate: number;
  esi_wage_limit: number;
  pt_enabled: boolean;
  pt_slabs: PtSlab[];
  tds_enabled: boolean;
  standard_deduction: number;
  rebate_limit: number;
  cess_rate: number;
  new_regime_slabs: Slab[];
}
export interface EmployeeStatutory {
  pf_opted_out?: boolean;
  esi_exempt?: boolean;
  tax_regime?: "NEW" | "OLD";
  tds_monthly_override?: number | null;
}
export interface StatutoryInput {
  gross: number;
  pfWages: number;
  settings: StatutorySettings;
  employee?: EmployeeStatutory | null;
}
export interface StatutoryLine {
  code: string;
  label: string;
  amount: number;
  employer?: boolean;
  note?: string;
}
export interface StatutoryResult {
  pfEmployee: number;
  pfEmployer: number;
  epsEmployer: number;
  epfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  tds: number;
  employeeTotal: number;
  employerTotal: number;
  lines: StatutoryLine[];
  notes: string[];
  annualTaxableProjection: number;
  annualTax: number;
}

export const DEFAULT_STATUTORY: StatutorySettings = {
  pf_enabled: true,
  pf_employee_rate: 12,
  pf_employer_rate: 12,
  pf_wage_ceiling: 25000,
  pf_restrict_to_ceiling: true,
  esi_enabled: true,
  esi_employee_rate: 0.75,
  esi_employer_rate: 3.25,
  esi_wage_limit: 21000,
  pt_enabled: false,
  pt_slabs: [],
  tds_enabled: true,
  standard_deduction: 75000,
  rebate_limit: 1200000,
  cess_rate: 4,
  new_regime_slabs: [
    { upto: 400000, rate: 0 },
    { upto: 800000, rate: 5 },
    { upto: 1200000, rate: 10 },
    { upto: 1600000, rate: 15 },
    { upto: 2000000, rate: 20 },
    { upto: 2400000, rate: 25 },
    { upto: null, rate: 30 },
  ],
};
const EPS_RATE = 8.33;
const r0 = (n: number) => Math.round(n);

/** Slab tax on an annual taxable income (before rebate and cess). */
export function slabTax(taxable: number, slabs: Slab[]): number {
  let tax = 0,
    lower = 0;
  for (const s of slabs) {
    const upper = s.upto ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * (s.rate / 100);
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

/** New-regime annual income tax incl. Section 87A rebate (with marginal relief) and cess. */
export function annualTaxNewRegime(
  annualGross: number,
  s: Pick<StatutorySettings, "standard_deduction" | "rebate_limit" | "cess_rate" | "new_regime_slabs">,
) {
  const taxable = Math.max(0, annualGross - s.standard_deduction);
  let tax = slabTax(taxable, s.new_regime_slabs);
  if (taxable <= s.rebate_limit) tax = 0;
  else tax = Math.min(tax, taxable - s.rebate_limit); // marginal relief: tax can't exceed income above the limit
  return { taxable, tax: r0(tax * (1 + s.cess_rate / 100)) };
}

export function computeStatutory({ gross, pfWages, settings: s, employee: e }: StatutoryInput): StatutoryResult {
  const lines: StatutoryLine[] = [],
    notes: string[] = [];
  gross = Math.max(0, gross);
  pfWages = Math.max(0, pfWages);

  // EPF
  let pfEmployee = 0,
    pfEmployer = 0,
    epsEmployer = 0,
    epfEmployer = 0;
  if (s.pf_enabled && pfWages > 0) {
    if (e?.pf_opted_out) notes.push("PF: employee opted out (wages above ceiling at joining).");
    else {
      const base = s.pf_restrict_to_ceiling ? Math.min(pfWages, s.pf_wage_ceiling) : pfWages;
      pfEmployee = r0((base * s.pf_employee_rate) / 100);
      pfEmployer = r0((base * s.pf_employer_rate) / 100);
      epsEmployer = Math.min(pfEmployer, r0((Math.min(pfWages, s.pf_wage_ceiling) * EPS_RATE) / 100));
      epfEmployer = pfEmployer - epsEmployer;
      lines.push({
        code: "PF_EE",
        label: `Provident Fund (${s.pf_employee_rate}% of ₹${base.toLocaleString("en-IN")})`,
        amount: pfEmployee,
      });
      lines.push({
        code: "PF_ER",
        label: "Employer PF (EPF + EPS)",
        amount: pfEmployer,
        employer: true,
        note: `EPS ₹${epsEmployer}, EPF ₹${epfEmployer}`,
      });
    }
  }
  // ESI
  let esiEmployee = 0,
    esiEmployer = 0;
  if (s.esi_enabled && gross > 0) {
    if (e?.esi_exempt) notes.push("ESI: marked exempt for this employee.");
    else if (gross <= s.esi_wage_limit) {
      esiEmployee = Math.ceil((gross * s.esi_employee_rate) / 100);
      esiEmployer = Math.ceil((gross * s.esi_employer_rate) / 100);
      lines.push({ code: "ESI_EE", label: `ESI (${s.esi_employee_rate}% of gross)`, amount: esiEmployee });
      lines.push({ code: "ESI_ER", label: `Employer ESI (${s.esi_employer_rate}%)`, amount: esiEmployer, employer: true });
    } else notes.push(`ESI: gross above ₹${s.esi_wage_limit.toLocaleString("en-IN")} — not covered.`);
  }
  // Professional tax
  let pt = 0;
  if (s.pt_enabled && s.pt_slabs.length) {
    const slab = [...s.pt_slabs].sort((a, b) => (a.upto ?? Infinity) - (b.upto ?? Infinity)).find((x) => gross <= (x.upto ?? Infinity));
    pt = Math.max(0, slab?.amount ?? 0);
    if (pt) lines.push({ code: "PT", label: "Professional tax", amount: pt });
  }
  // TDS
  let tds = 0,
    annualTaxableProjection = 0,
    annualTax = 0;
  if (s.tds_enabled) {
    if (e?.tds_monthly_override != null) {
      tds = r0(e.tds_monthly_override);
      notes.push("TDS: monthly amount set manually for this employee.");
    } else if (e?.tax_regime === "OLD") {
      notes.push("TDS: old regime needs investment declarations — set a monthly TDS override for this employee.");
    } else {
      const t = annualTaxNewRegime(gross * 12, s);
      annualTaxableProjection = t.taxable;
      annualTax = t.tax;
      tds = r0(t.tax / 12);
      if (t.tax === 0 && t.taxable > 0)
        notes.push(
          `TDS: nil — projected taxable ₹${t.taxable.toLocaleString("en-IN")} is within the ₹${s.rebate_limit.toLocaleString("en-IN")} rebate limit.`,
        );
    }
    if (tds)
      lines.push({
        code: "TDS",
        label: "Income tax (TDS)",
        amount: tds,
        note: annualTax ? `Projected annual tax ₹${annualTax.toLocaleString("en-IN")}` : undefined,
      });
  }
  const employeeTotal = pfEmployee + esiEmployee + pt + tds;
  return {
    pfEmployee,
    pfEmployer,
    epsEmployer,
    epfEmployer,
    esiEmployee,
    esiEmployer,
    pt,
    tds,
    employeeTotal,
    employerTotal: pfEmployer + esiEmployer,
    lines,
    notes,
    annualTaxableProjection,
    annualTax,
  };
}

export function normaliseSettings(row: Record<string, unknown> | null | undefined): StatutorySettings {
  if (!row) return DEFAULT_STATUTORY;
  const n = (k: keyof StatutorySettings) => (row[k] === null || row[k] === undefined ? (DEFAULT_STATUTORY[k] as number) : Number(row[k]));
  const b = (k: keyof StatutorySettings) => (row[k] === null || row[k] === undefined ? (DEFAULT_STATUTORY[k] as boolean) : Boolean(row[k]));
  return {
    pf_enabled: b("pf_enabled"),
    pf_employee_rate: n("pf_employee_rate"),
    pf_employer_rate: n("pf_employer_rate"),
    pf_wage_ceiling: n("pf_wage_ceiling"),
    pf_restrict_to_ceiling: b("pf_restrict_to_ceiling"),
    esi_enabled: b("esi_enabled"),
    esi_employee_rate: n("esi_employee_rate"),
    esi_employer_rate: n("esi_employer_rate"),
    esi_wage_limit: n("esi_wage_limit"),
    pt_enabled: b("pt_enabled"),
    pt_slabs: Array.isArray(row.pt_slabs) ? (row.pt_slabs as PtSlab[]) : [],
    tds_enabled: b("tds_enabled"),
    standard_deduction: n("standard_deduction"),
    rebate_limit: n("rebate_limit"),
    cess_rate: n("cess_rate"),
    new_regime_slabs:
      Array.isArray(row.new_regime_slabs) && (row.new_regime_slabs as Slab[]).length
        ? (row.new_regime_slabs as Slab[])
        : DEFAULT_STATUTORY.new_regime_slabs,
  };
}
