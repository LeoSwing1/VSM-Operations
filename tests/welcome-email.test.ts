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
