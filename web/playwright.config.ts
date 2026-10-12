import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
/**
 * Second dev server with placeholder Clerk keys for tests/e2e/clerk.spec.ts. It is bound to `localhost`, not 127.0.0.1:
 * clerkMiddleware forwards auth headers through a same-URL rewrite, and Next's dev server only treats that rewrite as
 * internal when the URL's host matches the hostname it listens on; otherwise it proxies the request to itself forever.
 */
const CLERK_PORT = PORT + 1;
const CLERK_BASE_URL = `http://localhost:${CLERK_PORT}`;

// Providers are mocked at the adapter boundary; no key or network access is needed.
const SERVER_ENV = {
  ARC_MOCK_PROVIDERS: "1",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  TYPESAFE_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
  CLERK_TELEMETRY_DISABLED: "1",
};

/**
 * Placeholder keys for a production-type Clerk instance at a domain that does not exist. A signed-out request to a
 * production instance is resolved locally by the middleware, so no request ever reaches Clerk. (`pk_live_` encodes
 * "clerk.arc-test.example$".)
 */
export const FAKE_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuYXJjLXRlc3QuZXhhbXBsZSQ=";
const FAKE_CLERK_SECRET_KEY = "sk_live_playwright_placeholder_not_a_real_key";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /clerk\.spec\.ts/u, use: { ...devices["Desktop Chrome"] } },
    { name: "clerk", testMatch: /clerk\.spec\.ts/u, use: { ...devices["Desktop Chrome"], baseURL: CLERK_BASE_URL } },
  ],
  webServer: [
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/models`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: SERVER_ENV,
    },
    {
      command: `pnpm exec next dev --hostname localhost --port ${CLERK_PORT}`,
      url: `${CLERK_BASE_URL}/api/models`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...SERVER_ENV,
        NEXT_DIST_DIR: ".next-clerk",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_CLERK_PUBLISHABLE_KEY,
        CLERK_SECRET_KEY: FAKE_CLERK_SECRET_KEY,
      },
    },
  ],
});
