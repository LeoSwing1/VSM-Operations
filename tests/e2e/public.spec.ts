import { expect, test } from "@playwright/test";

test("login page renders the form and the connection test link", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('form[action="/auth/sign-in"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /test connection/i })).toBeVisible();
});

test("protected pages redirect to login", async ({ page }) => {
  for (const path of [
    "/dashboard",
    "/operations",
    "/scholars",
    "/payroll/statutory",
    "/growth",
    "/reports",
    "/assistant",
    "/kyc",
    "/people/kyc",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("wrong password shows a friendly message, never a crash", async ({ page }) => {
  await page.goto("/login?forgot=0");
  await page.fill('input[name="email"]', "nobody@example.com");
  await page.fill('input[name="password"]', "definitely-wrong-123");
  await page.click('form[action="/auth/sign-in"] button[type="submit"], form[action="/auth/sign-in"] button');
  await expect(page).toHaveURL(/\/login\?err=/);
});

test("sign-in refuses cross-site form posts", async ({ request }) => {
  const r = await request.post("/auth/sign-in", {
    form: { email: "a@b.co", password: "12345678" },
    headers: { origin: "https://evil.example" },
    maxRedirects: 0,
  });
  expect(r.status()).toBe(303);
  expect(r.headers()["location"]).toContain("Please%20sign%20in%20from%20the%20VSM%20Ops%20page");
});

test("status page and offline page are public", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByText(/connection test/i)).toBeVisible();
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
});

test("certificate verification: bad codes reveal nothing", async ({ page }) => {
  await page.goto("/verify/zzzzzzzzzzzz");
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
});

test("security headers are set", async ({ request }) => {
  const r = await request.get("/login");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  expect(r.headers()["permissions-policy"]).toContain("geolocation=(self)");
});

test("AI chat, report downloads and the accountant pack need a signed-in session", async ({ request }) => {
  const chat = await request.post("/api/ai/chat", { data: { messages: [{ role: "user", content: "hi" }] }, maxRedirects: 0 });
  expect([401, 403, 307, 308]).toContain(chat.status());
  for (const path of [
    "/api/reports/runs/00000000-0000-0000-0000-000000000000",
    "/api/reports/accountant?month=2026-10",
    "/api/cron/reports",
  ]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).not.toBe(200);
  }
});
