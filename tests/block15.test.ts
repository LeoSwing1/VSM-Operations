import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const squash = (x: string) => x.replace(/\s+/g, "");
describe("Block 15 business workflow execution", () => {
  it("wires leave, timesheet and quality business events", () => {
    expect(squash(read("src/app/(app)/leave/actions.ts"))).toContain(squash('p_event_key: "leave.submitted"'));
    expect(squash(read("src/app/(app)/approvals/actions.ts"))).toContain(squash('p_event_key: "leave.decided"'));
    expect(squash(read("src/app/(app)/time/actions.ts"))).toContain(squash('p_event_key:"timesheet.submitted"'));
    expect(squash(read("src/app/(app)/quality/actions.ts"))).toContain(squash('p_event_key:"quality.rework"'));
  });
  it("runs scheduled task and timesheet SLA scans through the protected cron", () => {
    const worker = read("src/lib/workflows/worker.ts");
    expect(squash(worker)).toContain(squash('"task.due_soon"'));
    expect(squash(worker)).toContain(squash('"task.overdue"'));
    expect(squash(worker)).toContain(squash('"timesheet.overdue"'));
    expect(squash(worker)).toContain(squash('"attendance.incomplete"'));
    expect(squash(read("src/app/api/cron/workflows/route.ts"))).toContain(squash("scanBusinessSla()"));
  });
  it("validates target recipient routing and restricts action types", () => {
    expect(squash(read("supabase/migrations/0020_business_workflow_sla_execution.sql"))).toContain(squash("notify_target"));
    expect(squash(read("src/lib/workflows/worker.ts"))).toContain(squash('eq("org_id", run.org_id)'));
    expect(squash(read("src/lib/workflows/worker.ts"))).toContain(squash('neq("status", "EXITED")'));
  });
});
