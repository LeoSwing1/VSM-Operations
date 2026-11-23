import { describe, it, expect } from "vitest";
import { readFileSync as readRaw } from "node:fs";
/** Contract tests compare source with all whitespace removed, so reformatting can't break them. */
const squash = (x: string) => x.replace(/\s+/g, "");
const readFileSync = (p: string, enc: "utf8") => squash(readRaw(p, enc));
import { join } from "node:path";
const root = process.cwd();
describe("Block 11 workflow builder and execution contracts", () => {
  const migration = readFileSync(join(root, "supabase/migrations/0017_workflow_builder_execution.sql"), "utf8");
  const actions = readFileSync(join(root, "src/app/(app)/settings/workflows/actions.ts"), "utf8");
  const worker = readFileSync(join(root, "src/lib/workflows/worker.ts"), "utf8");
  const task = readFileSync(join(root, "src/app/(app)/tasks/actions.ts"), "utf8");
  it("restricts actions to typed notifications", () => {
    expect(migration).toMatch(/notin\('notify_actor'/);
    expect(actions).toMatch(/"notify_actor"/);
    expect(worker).toContain(squash("Unsupported workflow action"));
  });
  it("binds event actor to authenticated employee", () => {
    expect(migration).toContain(squash("p_payload->>'actor_employee_id'"));
    expect(migration).toContain(squash("current_employee_id()"));
  });
  it("wires task creation with a stable idempotency key", () => {
    expect(task).toContain(squash('p_event_key: "task.created"'));
    expect(task).toContain(squash("p_idempotency_key: task.id"));
  });
  it("keeps worker endpoint cron-secret protected", () => {
    const route = readFileSync(join(root, "src/app/api/cron/workflows/route.ts"), "utf8");
    expect(route).toContain(squash("cronAuthorized(req)"));
    expect(route).toMatch(/drainWorkflowRuns\(\d+\)/);
  });
  it("uses deterministic notification deduplication", () => {
    expect(worker).toContain(squash("dedupe_key:`workflow:${run.id}:${results.length}`"));
  });
});
