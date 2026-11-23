import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { render } from "@/lib/email/templates";
import { AUTH_COOKIE_OPTIONS, hardenCookie } from "@/lib/supabase/cookies";
import { CATEGORIES, DEFAULT_MODE } from "@/lib/notification-categories";
import { readFileSync } from "node:fs";

describe("Block 1", () => {
  it("session cookies are always HttpOnly + SameSite=Lax, whatever the library passes", () => {
    expect(hardenCookie({ httpOnly: false, sameSite: "none", maxAge: 100 })).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 100,
    });
    expect(hardenCookie(undefined)).toMatchObject(AUTH_COOKIE_OPTIONS);
  });

  it("daily digest lists each item by its own subject, escaped", () => {
    const r = render("digest.daily", {
      name: "Aman",
      date: "2026-11-20",
      items: [
        { category: "TASKS", template: "task.assigned", payload: { title: "Landing <page> copy", task_id: "t1" } },
        {
          category: "PAYROLL",
          template: "payroll.payslip_available",
          payload: { period_start: "2026-10-01", period_end: "2026-10-31", net_amount: 99999 },
        },
      ],
    })!;
    expect(r.subject).toBe("Your VSM daily summary: 2 updates");
    expect(r.html).toContain("Landing &lt;page&gt; copy");
    expect(r.text).toContain("[PAYROLL] Your payslip is ready");
    expect(r.html + r.text).not.toContain("99999");
  });

  it("UI categories match the database list exactly", () => {
    const sql = readFileSync("supabase/migrations/0007_notification_prefs_integrations.sql", "utf8");
    const dbList = sql
      .match(/array\[([^\]]+)\]/)![1]!
      .replace(/[\s']/g, "")
      .split(",");
    expect([...CATEGORIES.map((c) => c.key), "SYSTEM"].sort()).toEqual([...dbList].sort());
    expect(DEFAULT_MODE("CHAT")).toBe("DIGEST");
    expect(DEFAULT_MODE("TASKS")).toBe("IMMEDIATE");
  });

  it("browser client is Realtime-only and never sees the refresh token", () => {
    const browser = readFileSync("src/lib/supabase/browser.ts", "utf8");
    expect(browser).not.toContain("@supabase/ssr"); // no cookie-reading client
    expect(browser).toContain("persistSession: false"); // nothing stored in localStorage
    expect(browser).toContain("/api/realtime/token");
    const route = readFileSync("src/app/api/realtime/token/route.ts", "utf8");
    expect(route).toContain("auth.getUser()"); // verified session, not just the cookie
    expect(route).not.toContain("refresh_token"); // refresh token never leaves the server
    expect(route).toContain("no-store");
  });
});
