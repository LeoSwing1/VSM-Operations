import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));

const { liveClock, hms } = await import("@/lib/engines/clock");
const { temporaryPassword } = await import("@/lib/passwords");
const { DEMO_PEOPLE, demoDomain } = await import("@/lib/demo");
const read = (p: string) => readFileSync(p, "utf8");
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 23, h, m)).toISOString();
const ms = (h: number, m = 0) => Date.parse(at(h, m));

describe("live work clock", () => {
  it("is off before clock-in", () => expect(liveClock([], ms(4))).toMatchObject({ state: "OFF", workedMs: 0, running: false }));
  it("starts ticking from the clock-in second", () => {
    const c = liveClock([{ event_type: "CLOCK_IN", occurred_at: at(4) }], ms(4, 30) + 15_000);
    expect(c.state).toBe("WORKING");
    expect(hms(c.workedMs)).toBe("00:30:15");
  });
  it("pauses during a break and resumes after", () => {
    const ev = [
      { event_type: "CLOCK_IN" as const, occurred_at: at(4) },
      { event_type: "BREAK_START" as const, occurred_at: at(6) },
    ];
    expect(liveClock(ev, ms(6, 45))).toMatchObject({ state: "BREAK", workedMs: 2 * 3600_000, breakMs: 45 * 60_000 });
    const resumed = liveClock([...ev, { event_type: "BREAK_END", occurred_at: at(7) }], ms(8));
    expect(resumed).toMatchObject({ state: "WORKING", workedMs: 3 * 3600_000, breakMs: 3600_000 });
  });
  it("stops at clock-out", () => {
    const c = liveClock(
      [
        { event_type: "CLOCK_IN", occurred_at: at(4) },
        { event_type: "CLOCK_OUT", occurred_at: at(12) },
      ],
      ms(15),
    );
    expect(c).toMatchObject({ state: "DONE", workedMs: 8 * 3600_000, running: false });
  });
  it("ignores odd sequences (double clock-in, break without clock-in)", () => {
    const c = liveClock(
      [
        { event_type: "BREAK_START", occurred_at: at(3) },
        { event_type: "CLOCK_IN", occurred_at: at(4) },
        { event_type: "CLOCK_IN", occurred_at: at(5) },
      ],
      ms(6),
    );
    expect(c.workedMs).toBe(2 * 3600_000);
  });
});

describe("passwords and demo team", () => {
  it("temporary passwords are strong, readable and unique", () => {
    const set = new Set(Array.from({ length: 200 }, temporaryPassword));
    expect(set.size).toBe(200);
    for (const p of set) {
      expect(p).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-\d{2}$/);
      expect(p.slice(0, 14)).not.toMatch(/[0O1lI]/); // no look-alike characters in the letter groups
    }
  });
  it("demo team = HR Manager, 2 SEO Executives, Video Editor, Web Developer — never a Super Admin", () => {
    expect(DEMO_PEOPLE.map((p) => p.designation)).toEqual([
      "HR Manager",
      "SEO Executive",
      "SEO Executive",
      "Video Editor",
      "Web Developer",
    ]);
    expect(DEMO_PEOPLE.some((p) => (p.role as string) === "SUPER_ADMIN" || (p.role as string) === "ADMIN")).toBe(false);
  });
  it("demo domain falls back safely", () => {
    expect(demoDomain({ DEMO_EMAIL_DOMAIN: "Demo.Example.com" })).toBe("demo.example.com");
    expect(demoDomain({ DEMO_EMAIL_DOMAIN: "bad domain" })).toBe("demo.vsmgrowth.com");
  });
  it("no hard-coded passwords anywhere in the demo or bootstrap code", () => {
    for (const f of ["src/lib/demo.ts", "scripts/local-bootstrap.mjs", "scripts/local-up.ps1"])
      expect(read(f)).not.toMatch(/password\s*[:=]\s*["'][^"']{6,}["']/i);
  });
});

describe("Block 18 wiring", () => {
  it("password reset is gated by the database rule and never targets the Super Admin", () => {
    const a = read("src/app/(app)/people/password-actions.ts");
    expect(a).toContain('requirePerm("people.reset_password")');
    expect(a).toContain('rpc("can_reset_password"');
    expect(read("supabase/migrations/0024_block18_people_teams_live.sql")).toMatch(/t\.role <> 'SUPER_ADMIN'/);
  });
  it("temporary passwords force a change at next sign-in", () => {
    expect(read("src/app/(app)/people/password-actions.ts")).toContain("must_change_password: true");
    expect(read("src/middleware.ts")).toContain("must_change_password");
    expect(read("src/app/auth/new-password/route.ts")).toContain("must_change_password: false");
  });
  it("status page and API are public but never expose keys", () => {
    const s = read("src/lib/status.ts");
    expect(read("src/middleware.ts")).toMatch(/status/);
    expect(s).not.toMatch(/detail:\s*(url|anon|key)/);
  });
  it("chat read clears chat notifications; badges are live", () => {
    expect(read("src/app/api/chat/[channelId]/read/route.ts")).toContain('rpc("mark_chat_read"');
    expect(read("src/components/shell-client.tsx")).toContain("<ChatUnread");
  });
  it("Windows notifications use the same tag as web push (no duplicates)", () => {
    expect(read("src/components/notifications/realtime-unread.tsx")).toMatch(/tag: row\.id/);
    expect(read("src/lib/delivery/messages.ts")).toMatch(/tag: str\(p\.notification_id/);
  });
  it("the local Docker script never overwrites an existing .env.local", () => {
    expect(read("scripts/local-up.ps1")).toMatch(/Test-Path \.env\.local\) \{ "\.env\.docker\.local" \}/);
    expect(read("scripts/local-bootstrap.mjs")).toMatch(/Refusing/);
  });
});

describe("Block 18.3 — profile, loader, auth forms, realtime", async () => {
  const { shortName, initialsOf, subtitleFor } = await import("@/lib/display-name");
  it("profile chip shows 'Sushant M.' and Owner for the Super Admin", () => {
    expect(shortName("Sushant Malik")).toBe("Sushant M.");
    expect(shortName("Vishant Kumar Malik")).toBe("Vishant M.");
    expect(shortName("Happy")).toBe("Happy");
    expect(initialsOf("Sushant Malik")).toBe("SM");
    expect(subtitleFor("SUPER_ADMIN", "Co-Founder", "Super Admin")).toBe("Owner");
    expect(subtitleFor("EMPLOYEE", "SEO Executive", "Employee")).toBe("SEO Executive");
    expect(subtitleFor("EMPLOYEE", null, "Employee")).toBe("Employee");
  });
  it("realtime components never create channels directly (avoids the 'after subscribe()' crash)", () => {
    for (const f of [
      "src/components/notifications/realtime-unread.tsx",
      "src/components/notifications/chat-unread.tsx",
      "src/components/live-sync.tsx",
      "src/components/chat/chat-room.tsx",
    ]) {
      const s = read(f);
      expect(s).toContain("openChannel(");
      expect(s).not.toMatch(/client\s*\.channel\(|\.removeChannel\(/);
    }
  });
  it("login, forgot and new-password are plain form posts with a same-origin check", () => {
    const page = read("src/app/login/page.tsx");
    expect(page).toContain('action="/auth/sign-in"');
    expect(page).toContain('action="/auth/forgot"');
    for (const r of ["sign-in", "forgot", "new-password"]) expect(read(`src/app/auth/${r}/route.ts`)).toContain("sameOrigin(req)");
  });
  it("every loading state uses the VSM loader", () => {
    expect(read("src/app/(app)/loading.tsx")).toContain("VsmLoader");
    expect(read("src/components/vsm-loader.tsx")).toContain("Initializing");
  });
  it("welcome email carries details but the Super Admin is never onboarded through it", () => {
    const o = read("src/lib/onboarding.ts");
    expect(o).toContain('e.role === "SUPER_ADMIN"');
    const t = read("src/lib/email/templates.ts");
    for (const k of ["Employee ID", "Post", "Reports to", "Login email"]) expect(t).toContain(k);
  });
});
