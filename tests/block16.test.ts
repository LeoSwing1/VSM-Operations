import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Block 16 workflow approvals", () => {
  const root = process.cwd();
  it("defines durable organisation-scoped approval cases and RLS", () => {
    const sql = readFileSync(join(root, "supabase/migrations/0021_advanced_workflow_approvals.sql"), "utf8");
    expect(sql).toContain("workflow_approval_cases");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("approver_id=current_employee_id()");
  });
  it("keeps approval actions in the typed worker registry", () => {
    const worker = readFileSync(join(root, "src/lib/workflows/worker.ts"), "utf8");
    expect(worker).toContain('"create_approval"');
    expect(worker).toContain('"notify_manager"');
    expect(worker).toContain("escalateWorkflowApprovals");
  });
});
