import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state: { user: unknown; claims: unknown; signedOut: boolean } = { user: null, claims: null, signedOut: false };
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _u: string,
    _k: string,
    opts: { cookies: { setAll: (l: { name: string; value: string; options: object }[]) => void } },
  ) => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }),
      signOut: async () => {
        state.signedOut = true;
        opts.cookies.setAll([{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }]);
      },
    },
  }),
}));

afterEach(() => {
  state.user = null;
  state.claims = null;
  state.signedOut = false;
  vi.unstubAllEnvs();
});

async function run(path: string, cookie = "sb-x-auth-token=stale") {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  const { middleware } = await import("@/middleware");
  return middleware(new NextRequest(`https://vsm.test${path}`, { headers: { cookie } }));
}

describe("a stale login cookie (session ended on the server)", () => {
  it("shows the login form instead of the password page, and clears the dead cookie", async () => {
    // token still parses locally, but Supabase says the session is gone
    state.claims = { sub: "kevin", user_metadata: { must_change_password: true } };
    state.user = null;
    const res = await run("/login");
    expect(res.headers.get("location")).toBeNull(); // the login page renders
    expect(state.signedOut).toBe(true);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sb-x-auth-token=;/);
  });

  it("sends the password page to the login form, keeping the cookie clean-up", async () => {
    state.claims = { sub: "kevin" };
    const res = await run("/login/reset?forced=1");
    expect(res.headers.get("location")).toMatch(/\/login\?err=/);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sb-x-auth-token=;/);
  });

  it("a live session with a temporary password still goes to choose-your-password", async () => {
    state.user = { id: "kevin", user_metadata: { must_change_password: true } };
    state.claims = { sub: "kevin", user_metadata: { must_change_password: true } };
    const res = await run("/dashboard");
    expect(res.headers.get("location")).toMatch(/\/login\/reset\?forced=1/);
    const res2 = await run("/login/reset?forced=1");
    expect(res2.headers.get("location")).toBeNull();
  });
});
