import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL,
  password = process.env.E2E_PASSWORD;
test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD (a demo login on a staging project) to run signed-in tests.");

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', email!);
  await page.fill('input[name="password"]', password!);
  await page.click('form[action="/auth/sign-in"] button');
  await expect(page).toHaveURL(/\/dashboard/);
});

test("dashboard shows the live clock and profile menu", async ({ page }) => {
  await expect(page.getByLabel("Time worked today").first()).toBeVisible();
  await page.getByRole("button", { expanded: false }).filter({ hasText: /\./ }).first().click();
  await expect(page.getByRole("menuitem", { name: /my profile/i })).toBeVisible();
});

test("key pages load without errors", async ({ page }) => {
  for (const path of [
    "/attendance",
    "/tasks",
    "/chat",
    "/notifications",
    "/people/posts",
    "/growth",
    "/growth/kpis",
    "/growth/reviews",
    "/growth/training",
    "/reports",
    "/assistant",
  ]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBeLessThan(400);
    await expect(page.locator("main")).not.toContainText("Application error");
  }
});
