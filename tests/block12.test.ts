import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Block 12 admin and communication UI", () => {
  it("keeps the Super Admin console explicitly role-restricted", () => {
    const page = read("../src/app/(app)/settings/admin/page.tsx");
    expect(page).toContain('requirePerm("roles.manage")');
    expect(page).toContain('ctx.role !== "SUPER_ADMIN"');
    expect(page).toContain('from("role_settings")');
    expect(page).toContain('from("role_permissions")');
  });
  it("keeps access matrix editing on the existing server action", () => {
    const page = read("../src/app/(app)/settings/access/page.tsx");
    const actions = read("../src/app/(app)/settings/access/actions.ts");
    // Block 17: OPDesk-style instant toggles replace the batch form; same guarded server action file.
    const matrix = read("../src/app/(app)/settings/access/permission-matrix.tsx");
    expect(page).toContain("<PermissionMatrix");
    expect(matrix).toContain('role="switch"');
    expect(matrix).toContain("togglePermission(");
    expect(actions).toMatch(/export async function togglePermission[\s\S]*requirePerm\("roles\.manage"\)/);
    expect(actions).toContain('requirePerm("roles.manage")');
    expect(actions).toContain("ALL_PERMS.includes(perm)");
  });
  it("preserves chat membership APIs and adds inbox and message-bubble presentation", () => {
    const home = read("../src/app/(app)/chat/page.tsx");
    const room = read("../src/components/chat/chat-room.tsx");
    expect(home).toContain("Your conversations");
    expect(home).toContain("Discover channels");
    expect(room).toContain("justify-end");
    expect(room).toContain("addChatReaction");
    expect(room).toContain("reportChatMessage");
    expect(room).toContain("sendChatMessage");
  });
});
