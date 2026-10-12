import { expect, test } from "@playwright/test";

// The default dev server has no Clerk keys: accounts are hidden entirely rather than half-configured.

test("without Clerk keys the header has no sign-in control and /sign-in explains what to set", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Optimize a prompt" })).toBeVisible();
  await expect(page.getByTestId("account-control")).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveCount(0);

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Sign-in is not configured on this deployment.");
  await expect(page.getByRole("status")).toContainText("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
});
