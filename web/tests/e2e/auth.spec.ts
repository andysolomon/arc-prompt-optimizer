import { expect, test } from "@playwright/test";

// Playwright starts the dev server with AUTH_SECRET and placeholder Google and X credentials (see playwright.config.ts).
// No provider is contacted: the browser is stopped at the hop to the provider's authorization endpoint.

test("header offers sign-in and the sign-in page lists Google and X", async ({ page }) => {
  await page.goto("/library");
  const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/signin?callbackUrl=%2Flibrary");
  await signIn.click();
  // The first visit compiles the page in the dev server.
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with X" })).toBeVisible();
  await expect(page.getByTestId("signin-error")).toHaveCount(0);
});

test("Continue with Google starts the OAuth flow at Google with this site's callback URL", async ({ page }) => {
  let authorization: URL | null = null;
  await page.route("https://accounts.google.com/**", async (route) => {
    authorization = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider stub</title>" });
  });
  await page.goto("/signin?callbackUrl=%2Flibrary");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => authorization?.pathname).toBe("/o/oauth2/v2/auth");
  const params = authorization!.searchParams;
  expect(params.get("client_id")).toBe("google-test-client");
  expect(params.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/callback\/google$/u);
  expect(params.get("response_type")).toBe("code");
  expect(params.get("scope")).toContain("email");
  // Google is an OIDC provider; Auth.js protects the round trip with PKCE.
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("code_challenge")).toBeTruthy();
});

test("Continue with X starts the OAuth 2.0 flow at x.com with PKCE", async ({ page }) => {
  let authorization: URL | null = null;
  await page.route("https://x.com/**", async (route) => {
    authorization = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider stub</title>" });
  });
  await page.goto("/signin");
  await page.getByRole("button", { name: "Continue with X" }).click();
  await expect.poll(() => authorization?.pathname).toBe("/i/oauth2/authorize");
  const params = authorization!.searchParams;
  expect(params.get("client_id")).toBe("x-test-client");
  expect(params.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/twitter$/u);
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("code_challenge")).toBeTruthy();
});

test("account page requires a session and a sign-in error is shown", async ({ page, request }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Faccount$/u);
  await page.goto("/signin?error=AccessDenied");
  await expect(page.getByTestId("signin-error")).toContainText("Access was denied");

  const session = await request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
  const providers = await request.get("/api/auth/providers");
  expect(Object.keys(await providers.json()).sort()).toEqual(["google", "twitter"]);
});
