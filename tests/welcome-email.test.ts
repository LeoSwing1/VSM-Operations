import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/lib/email/templates";

afterEach(() => vi.unstubAllEnvs());

describe("welcome email", () => {
  it("has a login button to the live site, the salary date and no amounts", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    const m = render("employee.welcome", {
      name: "Kevin Leo",
      first_name: "Kevin",
      code: "VSM-0007",
      joining: "2027-01-01",
      joining_label: "1 Jan 2027",
      salary_label: "8th of every month · first salary 8 Jan 2027",
      email: "kevin@vsm.test",
      password: "Temp-Pass-123",
      link: "",
    })!;
    expect(m.html).toContain('href="https://vsm-operations.vercel.app/login"');
    expect(m.html).toContain("Log in to VSM Operations");
    expect(m.html).toContain("8th of every month · first salary 8 Jan 2027");
    expect(m.text).toContain("Login page: https://vsm-operations.vercel.app/login");
    expect(m.html).not.toMatch(/₹|INR/);
  });
  it("uses APP_URL when it is set", () => {
    vi.stubEnv("APP_URL", "https://ops.example.com/");
    const m = render("auth.new_password", { name: "A", email: "a@x.test", password: "x" })!;
    expect(m.html).toContain('href="https://ops.example.com/login"');
  });
});

describe("password reset email", () => {
  it("is branded, has the reset button and never contains a password", () => {
    vi.stubEnv("APP_URL", "https://vsm-operations.vercel.app");
    const link = "https://vsm-operations.vercel.app/auth/callback?token_hash=abc&type=recovery&next=/login/reset";
    const m = render("auth.reset_link", { name: "Kevin", email: "kevin@vsm.test", link })!;
    expect(m.subject).toBe("Reset your VSM Operations password");
    expect(m.html).toContain("VSM Growth Operations");
    expect(m.html).toContain("Choose a new password");
    expect(m.html).toContain(link.replace(/&/g, "&amp;"));
    expect(m.text).toContain(link);
    expect(m.html.toLowerCase()).not.toContain("temporary password");
  });
});

describe("reset links are scanner-safe", () => {
  it("emails point at the confirm page, never straight at the token check", async () => {
    const fs = await import("node:fs");
    for (const f of ["src/app/auth/forgot/route.ts", "src/app/(app)/people/password-actions.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).toContain("/auth/confirm?token_hash=");
      expect(src).not.toContain("/auth/callback?token_hash=");
    }
  });
});
