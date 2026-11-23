import { describe, expect, it } from "vitest";
import { annualTaxNewRegime, computeStatutory, DEFAULT_STATUTORY as S, slabTax } from "@/lib/engines/statutory";

describe("income tax — new regime FY 2026-27", () => {
  it("slab tax on ₹12 lakh is ₹60,000 before rebate", () => expect(slabTax(1200000, S.new_regime_slabs)).toBe(60000));
  it("₹12.75 lakh salary → nil tax (₹75k standard deduction + 87A rebate)", () => expect(annualTaxNewRegime(1275000, S).tax).toBe(0));
  it("₹10 lakh salary → nil tax", () => expect(annualTaxNewRegime(1000000, S)).toEqual({ taxable: 925000, tax: 0 }));
  it("marginal relief just above the limit: taxable ₹12,10,000 pays ₹10,000 + cess, not ₹61,500", () => {
    expect(annualTaxNewRegime(1285000, S).tax).toBe(10400);
  });
  it("₹20 lakh salary: slab tax on ₹19.25 lakh = ₹1,88,750 + 4% cess", () => {
    // 4-8L 20,000 + 8-12L 40,000 + 12-16L 60,000 + 16-19.25L 65,000 = 1,85,000
    expect(slabTax(1925000, S.new_regime_slabs)).toBe(185000);
    expect(annualTaxNewRegime(2000000, S).tax).toBe(192400);
  });
});

describe("PF / ESI / TDS per month", () => {
  it("₹18,000 gross, ₹10,000 basic: PF 1,200, ESI 135 (rounded up) / 585, no TDS", () => {
    const r = computeStatutory({ gross: 18000, pfWages: 10000, settings: S });
    expect([r.pfEmployee, r.pfEmployer, r.esiEmployee, r.esiEmployer, r.tds]).toEqual([1200, 1200, 135, 585, 0]);
    expect(r.epsEmployer).toBe(833);
    expect(r.employeeTotal).toBe(1335);
  });
  it("PF is capped at the ₹25,000 ceiling (₹3,000) and ESI stops above ₹21,000", () => {
    const r = computeStatutory({ gross: 60000, pfWages: 30000, settings: S });
    expect(r.pfEmployee).toBe(3000);
    expect(r.esiEmployee).toBe(0);
    expect(r.notes.join(" ")).toMatch(/ESI: gross above/);
  });
  it("₹1,50,000/month gross → monthly TDS from the annual projection", () => {
    const r = computeStatutory({ gross: 150000, pfWages: 60000, settings: S });
    expect(r.tds).toBe(Math.round(annualTaxNewRegime(1800000, S).tax / 12));
    expect(r.tds).toBeGreaterThan(0);
  });
  it("employee overrides: PF opt-out, ESI exempt, manual TDS, old regime note", () => {
    const r = computeStatutory({
      gross: 20000,
      pfWages: 20000,
      settings: S,
      employee: { pf_opted_out: true, esi_exempt: true, tds_monthly_override: 500 },
    });
    expect([r.pfEmployee, r.esiEmployee, r.tds]).toEqual([0, 0, 500]);
    const old = computeStatutory({ gross: 90000, pfWages: 30000, settings: S, employee: { tax_regime: "OLD" } });
    expect(old.tds).toBe(0);
    expect(old.notes.join(" ")).toMatch(/old regime/i);
  });
  it("professional tax uses the state slabs when enabled", () => {
    const r = computeStatutory({
      gross: 30000,
      pfWages: 15000,
      settings: {
        ...S,
        pt_enabled: true,
        pt_slabs: [
          { upto: 15000, amount: 0 },
          { upto: null, amount: 200 },
        ],
      },
    });
    expect(r.pt).toBe(200);
  });
  it("no negative or NaN amounts for zero pay", () => {
    const r = computeStatutory({ gross: 0, pfWages: 0, settings: S });
    expect(r.employeeTotal).toBe(0);
    expect(r.lines).toHaveLength(0);
  });
});
