import { describe, expect, it } from "vitest";
import { bookValue, categoryLabel, csvCell, defaultLife, isOverdue, monthsBetween, warrantyState } from "@/lib/engines/assets";

const today = new Date("2026-11-24T10:00:00Z");

describe("assets engine", () => {
  it("labels categories and picks a default life", () => {
    expect(categoryLabel("SIM")).toBe("SIM card");
    expect(defaultLife("LAPTOP")).toBe(36);
    expect(defaultLife("UNKNOWN")).toBe(36);
  });

  it("works out warranty state", () => {
    expect(warrantyState(null, today)).toBe("NONE");
    expect(warrantyState("2026-11-23", today)).toBe("EXPIRED");
    expect(warrantyState("2026-11-24", today)).toBe("EXPIRING");
    expect(warrantyState("2026-12-20", today)).toBe("EXPIRING");
    expect(warrantyState("2027-06-01", today)).toBe("ACTIVE");
  });

  it("counts whole months", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
    expect(monthsBetween("2027-01-01", "2026-01-01")).toBe(0);
  });

  it("depreciates straight-line to zero", () => {
    expect(bookValue(36000, "2026-11-01", 36, today)).toBe(36000);
    expect(bookValue(36000, "2025-11-01", 36, today)).toBe(24000);
    expect(bookValue(36000, "2020-01-01", 36, today)).toBe(0);
    expect(bookValue(null, "2025-11-01", 36, today)).toBeNull();
  });

  it("flags overdue returns only after the date", () => {
    expect(isOverdue("2026-11-24", today)).toBe(false);
    expect(isOverdue("2026-11-23", today)).toBe(true);
    expect(isOverdue(null, today)).toBe(false);
  });

  it("escapes CSV and blocks formula injection", () => {
    expect(csvCell('Dell "XPS", 13')).toBe('"Dell ""XPS"", 13"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
  });
});
