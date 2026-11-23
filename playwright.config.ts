import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests. Public checks run anywhere (CI, against `next start`).
 * Signed-in checks run only when E2E_EMAIL / E2E_PASSWORD are set — use a STAGING project and a demo login, never production data.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...(process.env.PW_CHROME ? { launchOptions: { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } } : {}),
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1366, height: 820 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
