import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const calls: string[] = [];
let rpcError = true;
let otherEmployeeOwnsLogin = false;
const employee = {
  id: "emp-1",
  org_id: "org",
  full_name: "Kevin Leo Swing",
  official_email: "kevinleoswing@gmail.com",
  employee_code: "VSM-0002",
  designation: "Full Stack Developer",
  joining_date: "2026-11-16",
  role: "EMPLOYEE",
  user_id: null,
  department: { name: "Engineering" },
  manager: null,
};

function table(name: string) {
  const q: any = {
    select: () => q,
    eq: (_c: string, v: string) => ((q._v = v), q),
    limit: () => q,
    single: async () => ({ data: employee, error: null }),
    maybeSingle: async () =>
      name === "employees"
        ? {
            data: otherEmployeeOwnsLogin && q._v === "auth-77" ? { id: "emp-9", full_name: "Someone Else", role: "EMPLOYEE" } : null,
            error: null,
          }
        : { data: null, error: null },
    update: (v: unknown) => {
      calls.push(`update ${name} ${JSON.stringify(v)}`);
      return { eq: async () => ({ error: null }) };
    },
  };
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: table,
    rpc: async () => (rpcError ? { data: null, error: { message: "function does not exist" } } : { data: null, error: null }),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: "auth-77", email: "KevinLeoSwing@gmail.com" }] }, error: null }),
        updateUserById: async (id: string) => {
          calls.push(`password ${id}`);
          return { error: null };
        },
        createUser: async () => {
          calls.push("createUser");
          return { data: null, error: new Error("A user with this email address has already been registered") };
        },
      },
    },
  }),
}));
vi.mock("@/lib/email/providers", () => ({
  getProvider: async () => ({
    send: async (m: { to: string; text: string }) =>
      calls.push(`mail ${m.to} ${/VSM-0002/.test(m.text)} ${/Temporary password/.test(m.text)}`),
  }),
}));

describe("welcome email when a login already exists", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.EMAIL_FROM = "VSM <ops@vsmgrowth.com>";
    rpcError = true;
    otherEmployeeOwnsLogin = false;
  });
  it("re-uses the leftover login (even before migration 0038), sets a temporary password and emails ID + password", async () => {
    const { sendWelcome } = await import("@/lib/onboarding");
    const pw = await sendWelcome("emp-1", "password");
    expect(pw.length).toBeGreaterThan(8);
    expect(calls).not.toContain("createUser");
    expect(calls).toContain('update employees {"user_id":"auth-77"}');
    expect(calls).toContain("password auth-77");
    expect(calls).toContain("mail kevinleoswing@gmail.com true true");
  });
  it("refuses when the login belongs to another employee", async () => {
    otherEmployeeOwnsLogin = true;
    const { sendWelcome } = await import("@/lib/onboarding");
    await expect(sendWelcome("emp-1", "password")).rejects.toThrow(/Someone Else/);
    expect(calls.some((c) => c.startsWith("mail"))).toBe(false);
  });
});
