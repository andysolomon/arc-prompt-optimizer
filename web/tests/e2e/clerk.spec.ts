import { expect, test } from "@playwright/test";

// Runs against the second dev server, started with placeholder production-instance Clerk keys (see playwright.config.ts).
// Clerk's script host does not exist, so the browser never gets past the loading state; these tests cover the server side:
// the middleware runs on every route without breaking pages or APIs, and the sign-in controls are mounted.

test.beforeEach(async ({ page }) => {
  await page.route("https://clerk.arc-test.example/**", (route) => route.abort("failed"));
});

test("pages and API routes still work with the Clerk middleware active", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Optimize a prompt" })).toBeVisible();
  await expect(page.getByTestId("account-control")).toBeVisible();
  await expect(page.getByTestId("account-loading")).toBeVisible();

  const models = await request.get("/api/models");
  expect(models.status()).toBe(200);
  const invalid = await request.post("/api/optimize", { data: { prompt: "", model: "openai/gpt-5-mini", judge: false } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({ error: "Prompt must not be empty." });
});

test("the sign-in page mounts Clerk's component instead of the not-configured notice", async ({ page }) => {
  await page.goto("/sign-in?redirect_url=%2Flibrary");
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByText("Sign-in is not configured")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Optimize" })).toBeVisible();
});
