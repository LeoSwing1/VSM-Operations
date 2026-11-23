import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Block 13 integration control centre", () => {
  it("persists organisation-scoped diagnostic history with permission checks", () => {
    const migration = read("../supabase/migrations/0018_integration_control_centre.sql");
    expect(migration).toContain("create table integration_check_runs");
    expect(migration).toContain("has_perm('settings.manage')");
    expect(migration).toContain("checked_by = current_employee_id()");
  });
  it("uses real server-side probes for Storage, Auth Admin and Realtime", () => {
    const actions = read("../src/app/(app)/settings/integrations/actions.ts");
    expect(actions).toContain("storage.listBuckets()");
    expect(actions).toContain("auth.admin.listUsers");
    expect(actions).toContain("channel.subscribe");
    expect(actions).toContain("removeChannel(channel)");
    expect(actions).toContain('requirePerm("settings.manage")');
  });
  it("distinguishes OAuth configuration from actual linked calendar accounts", () => {
    const page = read("../src/app/(app)/settings/integrations/page.tsx");
    expect(page).toContain('from("calendar_provider_connections")');
    expect(page).toContain("CREDENTIALS MISSING");
    expect(page).toContain("READY · NO ACCOUNTS");
  });
  it("does not claim unbuilt providers are integrated", () => {
    const page = read("../src/app/(app)/settings/integrations/page.tsx");
    expect(page).toContain("Not integrated");
    expect(page).toContain("WhatsApp Business");
    expect(page).toContain("Meta Lead Ads");
    expect(page).toContain("Razorpay");
  });
});
