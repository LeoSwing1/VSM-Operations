import { describe, expect, it } from "vitest";
import { csvCell } from "../src/lib/reports/csv";

describe("executive CSV export safety", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('North, "Growth"\nTeam')).toBe('"North, ""Growth""\nTeam"');
  });
  it.each(["=1+1", "+SUM(A1:A2)", "-cmd", "@HYPERLINK(\"x\")", "\tformula", "\rformula"])(
    "neutralises spreadsheet formula prefix %s", (value) => {
      expect(csvCell(value).startsWith("\"'")).toBe(true);
    },
  );
  it("renders nullish values as empty cells", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});
