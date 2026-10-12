import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Providers are mocked at the adapter boundary; no key or network access is needed.
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/models`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ARC_MOCK_PROVIDERS: "1",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      TYPESAFE_API_KEY: "",
      // Sign-in UI with placeholder OAuth clients; auth.spec.ts stops the browser before any provider is reached.
      AUTH_SECRET: "playwright-only-secret-not-for-production",
      AUTH_GOOGLE_ID: "google-test-client",
      AUTH_GOOGLE_SECRET: "google-test-secret",
      AUTH_TWITTER_ID: "x-test-client",
      AUTH_TWITTER_SECRET: "x-test-secret",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
