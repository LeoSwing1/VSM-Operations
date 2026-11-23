import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { makePdf, makeXlsx } from "../src/lib/reports/workbook";
const sql = readFileSync("supabase/migrations/0015_advanced_calendar_time_quality_exports.sql", "utf8");
describe("Block 09 advanced calendar, evidence and exports", () => {
  it("keeps provider credentials and calendar mappings tenant-scoped", () => {
    for (const t of ["calendar_provider_connections", "calendar_sync_links", "calendar_email_deliveries", "quality_evidence"])
      expect(sql).toContain(`alter table ${t} enable row level security`);
    expect(sql).toContain("access_token_enc");
    expect(sql).toContain("revoke all on table calendar_provider_connections from anon,authenticated");
    expect(sql).toContain("grant select(id,org_id,employee_id,provider,account_email");
    expect(sql).toContain("quality_evidence_storage_insert");
  });
  it("bounds recurring event creation and prevents overlapping active timers", () => {
    expect(sql).toContain("DAILY|WEEKLY|MONTHLY");
    expect(sql).toContain("calendar_recurrence_occurrence_unique");
    expect(sql).toContain("task_time_one_active_timer_per_employee");
    expect(sql).toContain("p_recurrence text");
    expect(sql).toContain("claim_calendar_email_deliveries");
    expect(sql).toContain("for update skip locked");
  });
  it("limits evidence uploads and records integrity metadata", () => {
    expect(sql).toContain("15728640");
    expect(sql).toContain("sha256 text");
    expect(sql).toContain("quality_evidence_storage_read");
  });
  it("generates valid OOXML zip and PDF document signatures", () => {
    const x = makeXlsx("QA Export", [
      ["Name", "Score"],
      ["Example", 95],
    ]);
    expect(Array.from(x.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const p = makePdf("QA Export", ["Example | 95"]);
    expect(new TextDecoder().decode(p.slice(0, 8))).toContain("%PDF-1.");
  });
});
