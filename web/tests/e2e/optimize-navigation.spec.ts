import { expect, test, type Page } from "@playwright/test";

const PROMPT = "Summarize this incident report for executives.";

interface ControlledRun {
  /** Runs started (POST). */
  requests: number;
  /** Cancels or discards sent to the server (DELETE). */
  cancelled: number;
  /** The server has finished the run; the page is being fed its steps on demand. */
  ready: boolean;
  advance: () => void;
  finish: () => void;
}

declare global {
  interface Window {
    optimizationRun: ControlledRun;
  }
}

async function controlRun(page: Page) {
  // Use the real mocked run on the server, but reveal its steps to the page on demand so navigation exercises
  // a live, polled run without relying on timing or calling paid providers.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state: ControlledRun & { revealed: number | "all-but-two"; finished: boolean } = {
      requests: 0,
      cancelled: 0,
      ready: false,
      revealed: 1,
      finished: false,
      advance: () => {
        state.revealed = "all-but-two";
      },
      finish: () => {
        state.finished = true;
      },
    };
    window.optimizationRun = state;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/optimize/runs")) return originalFetch(input, init);
      const method = init?.method ?? "GET";
      if (method === "POST") state.requests += 1;
      if (method === "DELETE") state.cancelled += 1;
      const response = await originalFetch(input, init);
      if (method !== "GET" || !response.ok) return response;
      const record = (await response.json()) as { status: string; steps: unknown[]; result?: unknown };
      if (record.status === "done") state.ready = true;
      if (state.finished) return new Response(JSON.stringify(record), { status: 200, headers: { "content-type": "application/json" } });
      const count = state.revealed === "all-but-two" ? Math.max(0, record.steps.length - 2) : state.revealed;
      const partial = { ...record, status: "running", result: undefined, steps: record.steps.slice(0, count) };
      return new Response(JSON.stringify(partial), { status: 200, headers: { "content-type": "application/json" } });
    };
  });
}

async function startRun(page: Page) {
  await page.getByRole("textbox", { name: "Prompt" }).fill(PROMPT);
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.optimizationRun.ready), { timeout: 20_000 }).toBe(true);
  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Rewrite the prompt and plan the checks (done)")).toBeVisible();
}

test("tab navigation retains the request, receives progress, and keeps results completed on Patterns", async ({ page }) => {
  await controlRun(page);
  await page.goto("/");
  await startRun(page);

  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.evaluate(() => window.optimizationRun.advance());
  await page.getByRole("link", { name: "Optimize", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Run baseline (done)")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(1);
  expect(await page.evaluate(() => window.optimizationRun.cancelled)).toBe(0);

  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.evaluate(() => window.optimizationRun.finish());
  // Persistence confirms the result was consumed while Optimize was unmounted.
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("arc-po-session") ?? "{}").result?.completionsUsed)).toBe(5);
  await page.getByRole("link", { name: "Optimize", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await expect(page.getByText("5 completions · Claude Sonnet 4.5")).toBeVisible();
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(1);
});

test("Cancel still stops the run after switching tabs and a new run can finish", async ({ page }) => {
  await controlRun(page);
  await page.goto("/");
  await startRun(page);
  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.getByRole("link", { name: "Optimize", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.optimizationRun.cancelled)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("arc-po-active-run"))).toBeNull();

  await startRun(page);
  await page.evaluate(() => window.optimizationRun.finish());
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(2);
});

test("loading an example preserves an active run and replaces the prompt after it finishes", async ({ page }) => {
  await controlRun(page);
  await page.goto("/");
  await startRun(page);
  await page.getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example prompts" })).toBeVisible();
  const examplePrompt = await page.locator("article#few_shot pre").textContent();
  await page.getByRole("link", { name: "Use Few-Shot Pattern example", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
  await expect(page.getByText("Finish or cancel the current optimization before loading an example.").first()).toBeVisible();
  expect(await page.evaluate(() => window.optimizationRun.cancelled)).toBe(0);
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(1);

  await page.evaluate(() => window.optimizationRun.finish());
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await page.getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example prompts" })).toBeVisible();
  await page.getByRole("link", { name: "Use Few-Shot Pattern example", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(examplePrompt!);
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(1);
});

test("a run in progress is picked up again after a reload and after the tab was closed", async ({ page, context }) => {
  await controlRun(page);
  await page.goto("/");
  await startRun(page);
  const active = await page.evaluate(() => JSON.parse(localStorage.getItem("arc-po-active-run") ?? "null") as { id: string } | null);
  expect(active?.id).toMatch(/^[0-9a-f-]{36}$/u);

  // A reload (the init script runs again, so the controlled run starts over at one revealed step) resumes the same run.
  await page.reload();
  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Rewrite the prompt and plan the checks (done)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.optimizationRun.requests)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.optimizationRun.ready), { timeout: 20_000 }).toBe(true);

  // A new tab (no sessionStorage, but the same localStorage) picks it up too, and fills the prompt from the run once it ends.
  const other = await context.newPage();
  await controlRun(other);
  await other.goto("/");
  await expect(other.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(other.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
  await expect.poll(() => other.evaluate(() => window.optimizationRun.ready), { timeout: 20_000 }).toBe(true);
  await other.evaluate(() => window.optimizationRun.finish());
  await expect(other.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await expect(other.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
  expect(await other.evaluate(() => localStorage.getItem("arc-po-active-run"))).toBeNull();
  await other.close();
});

test("New prompt clears the prompt, the details, and the previous result", async ({ page }) => {
  await controlRun(page);
  await page.goto("/");
  const newPrompt = page.getByRole("button", { name: "New prompt", exact: true });
  await expect(newPrompt).toBeDisabled();
  await startRun(page);
  await expect(newPrompt).toBeDisabled();
  await page.evaluate(() => window.optimizationRun.finish());
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await page.getByRole("button", { name: "Rewrite details (optional)" }).click();
  await page.getByRole("textbox", { name: "Target use case" }).fill("A weekly email.");
  await expect(newPrompt).toBeEnabled();
  await newPrompt.click();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Target use case" })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeDisabled();
  await expect(newPrompt).toBeDisabled();
});
