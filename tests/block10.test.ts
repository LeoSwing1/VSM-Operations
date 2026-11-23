import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/0016_workflow_automation_sla.sql", "utf8");
const aggregate = readFileSync("supabase/all_migrations.sql", "utf8");
describe("Block 10 workflow automation foundation", () => {
  it("keeps rules tenant-scoped and validates JSON payloads", () => {
    expect(sql).toContain("org_id=current_org_id()");
    expect(sql).toContain("jsonb_typeof(conditions)='object'");
    expect(sql).toContain("jsonb_typeof(actions)='array'");
    expect(sql).toContain("jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object'");
  });
  it("deduplicates events and safely claims concurrent jobs", () => {
    expect(sql).toContain("unique(org_id,idempotency_key)");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("locked_at<now()-interval");
  });
  it("limits retries and restricts worker functions to service role", () => {
    expect(sql).toContain("attempts<5");
    expect(sql).toContain("grant execute on function claim_workflow_runs(integer) to service_role");
    expect(sql).toContain("grant execute on function finish_workflow_run(uuid,text,jsonb,text) to service_role");
  });
  it("includes migration 0016 in the ordered aggregate", () => {
    expect(aggregate).toContain("-- Block 10: auditable workflow automation");
  });
});
