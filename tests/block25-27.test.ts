import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { fyQuarter, krProgress, kpiStatus, objectiveProgress, shiftQuarter, suggestedConfidence, timeElapsed } from "@/lib/engines/growth";
import { reportFile, reportRows } from "@/lib/reports/build";
import { makeXlsxSheets } from "@/lib/reports/workbook";
import { trimHistory, toolSpecs } from "@/lib/ai/spec";
import { defaultSalaryDay, nextSalaryDate, ordinal } from "@/lib/engines/salary-day";

describe("OKR helpers", () => {
  it("uses Indian financial-year quarters", () => {
    expect(fyQuarter("2026-11-23")).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q3 FY26-27" });
    expect(fyQuarter("2027-02-10")).toMatchObject({ start: "2027-01-01", end: "2027-03-31", label: "Q4 FY26-27" });
    expect(fyQuarter("2026-04-01")).toMatchObject({ start: "2026-04-01", end: "2026-06-30", label: "Q1 FY26-27" });
    expect(shiftQuarter("2026-10-01", 1).start).toBe("2027-01-01");
    expect(shiftQuarter("2026-10-01", -2).start).toBe("2026-04-01");
  });
  it("calculates key result and objective progress like the database", () => {
    expect(krProgress(0, 20, 5)).toBe(25);
    expect(krProgress(100, 60, 80)).toBe(50); // lower is better
    expect(krProgress(0, 10, 15)).toBe(100);
    expect(krProgress(0, 10, -3)).toBe(0);
    expect(
      objectiveProgress([
        { start_value: 0, target_value: 10, current_value: 5, weight: 1 },
        { start_value: 0, target_value: 4, current_value: 4, weight: 3 },
      ]),
    ).toBe(87.5);
    expect(objectiveProgress([])).toBeNull();
  });
  it("suggests confidence from progress vs time elapsed", () => {
    expect(timeElapsed("2026-10-01", "2026-12-31", "2026-11-15")).toBeGreaterThan(45);
    expect(suggestedConfidence(50, 50)).toBe("ON_TRACK");
    expect(suggestedConfidence(30, 50)).toBe("AT_RISK");
    expect(suggestedConfidence(10, 50)).toBe("OFF_TRACK");
    expect(suggestedConfidence(0, 5)).toBe("ON_TRACK");
  });
  it("judges KPIs by direction", () => {
    expect(kpiStatus(9, 10, "HIGHER")).toBe("BELOW");
    expect(kpiStatus(2, 3, "LOWER")).toBe("MET");
    expect(kpiStatus(null, 3, "LOWER")).toBe("NO_DATA");
    expect(kpiStatus(4, null, "HIGHER")).toBe("NO_TARGET");
  });
});

describe("report files", () => {
  const data = {
    title: "Attendance summary",
    columns: ["Employee ID", "Name", "Days present"],
    rows: [
      ["VSM-0005", "Aman A", 20],
      ["VSM-0006", "Bhavna B", 18],
    ],
    notes: ["Hours exclude breaks."],
    period_start: "2026-11-16",
    period_end: "2026-11-22",
    type: "ATTENDANCE_SUMMARY",
  };
  it("puts headers first and keeps numbers as numbers", () => {
    const rows = reportRows(data);
    expect(rows[0]).toEqual(["Employee ID", "Name", "Days present"]);
    expect(rows[2]![2]).toBe(18);
  });
  it("builds CSV, XLSX and PDF files", async () => {
    const csv = await reportFile(data, "CSV");
    expect(csv.contentType).toMatch(/text\/csv/);
    expect(new TextDecoder().decode(csv.body)).toContain("Bhavna B");
    const xlsx = await reportFile(data, "XLSX");
    expect(xlsx.ext).toBe("xlsx");
    expect(xlsx.body[0]).toBe(0x50); // "PK" zip
    const pdf = await reportFile(data, "PDF");
    expect(new TextDecoder().decode(pdf.body.slice(0, 5))).toBe("%PDF-");
  });
  it("writes multi-sheet workbooks for the accountant pack", () => {
    const book = makeXlsxSheets([
      {
        name: "Sales register",
        rows: [
          ["Invoice no", "Total"],
          ["VSM-1", 1180],
        ],
      },
      { name: "Receipts", rows: [["Date", "Amount"]] },
    ]);
    const text = new TextDecoder("latin1").decode(book);
    expect(text).toContain("xl/worksheets/sheet2.xml");
  });
});

describe("AI assistant", () => {
  it("offers only read tools and never payroll", () => {
    const names = toolSpecs.map((t) => t.name);
    expect(names).toContain("my_tasks");
    expect(names.some((n) => /payroll|salary|statutory|bank/.test(n))).toBe(false);
  });
  it("keeps a short, alternating history that starts with the user", () => {
    const h = trimHistory(
      Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" + i }) as const),
      12,
    );
    expect(h.length).toBeLessThanOrEqual(12);
    expect(h[0]!.role).toBe("user");
  });
});

describe("salary day", () => {
  it("defaults to joining date + 7 days", () => {
    expect(defaultSalaryDay("2027-01-01")).toBe(8);
    expect(defaultSalaryDay("2026-11-28")).toBe(5); // rolls into next month → the 5th
    expect(defaultSalaryDay("2026-11-16")).toBe(23);
  });
  it("finds the next pay date, clamped to short months", () => {
    expect(nextSalaryDate(8, "2026-11-24")).toBe("2026-12-08");
    expect(nextSalaryDate(8, "2026-11-08")).toBe("2026-11-08");
    expect(nextSalaryDate(31, "2027-02-10")).toBe("2027-02-28");
    expect(nextSalaryDate(31, "2026-12-31")).toBe("2026-12-31");
    expect(nextSalaryDate(5, "2026-12-20")).toBe("2027-01-05");
    expect(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(22)).toBe("1st2nd3rd11th22nd");
  });
});
