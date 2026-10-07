import { expect, test, type Page } from "@playwright/test";

const PROMPT = "Summarize this incident report for executives.";

interface ControlledStream {
  requests: number;
  aborted: number;
  ready: boolean;
  advance: () => void;
  finish: () => void;
}

declare global {
  interface Window {
    optimizationStream: ControlledStream;
  }
}

async function controlStream(page: Page) {
  // Use the real mocked API result, but release SSE frames on demand so navigation
  // exercises a live request without relying on timing or calling paid providers.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state: ControlledStream = {
      requests: 0,
      aborted: 0,
      ready: false,
      advance: () => {},
      finish: () => {},
    };
    window.optimizationStream = state;
    window.fetch = async (input, init) => {
      if (input !== "/api/optimize") return originalFetch(input, init);
      state.requests += 1;
      state.ready = false;
      const response = await originalFetch(input, init);
      if (!response.ok) return response;
      const frames = (await response.text()).split("\n\n").filter(Boolean);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (frame: string) => controller.enqueue(encoder.encode(`${frame}\n\n`));
          const onAbort = () => {
            state.aborted += 1;
            controller.error(init?.signal?.reason);
            state.ready = false;
          };
          init?.signal?.addEventListener("abort", onAbort, { once: true });
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          send(frames.shift()!);
          state.advance = () => {
            while (frames.length > 2) send(frames.shift()!);
          };
          state.finish = () => {
            while (frames.length > 0) send(frames.shift()!);
            controller.close();
            init?.signal?.removeEventListener("abort", onAbort);
            state.ready = false;
          };
          state.ready = true;
        },
      });
      return new Response(body, { headers: response.headers, status: response.status });
    };
  });
}

async function startRun(page: Page) {
  await page.getByRole("textbox", { name: "Prompt" }).fill(PROMPT);
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.optimizationStream.ready)).toBe(true);
  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Rewrite the prompt (done)")).toBeVisible();
}

test("tab navigation retains the request, receives progress, and keeps results completed on Patterns", async ({ page }) => {
  await controlStream(page);
  await page.goto("/");
  await startRun(page);

  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.evaluate(() => window.optimizationStream.advance());
  await page.getByRole("link", { name: "Optimize", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Run baseline (done)")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.optimizationStream.requests)).toBe(1);
  expect(await page.evaluate(() => window.optimizationStream.aborted)).toBe(0);

  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.evaluate(() => window.optimizationStream.finish());
  // Persistence confirms the result was consumed while Optimize was unmounted.
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("arc-po-session") ?? "{}").result?.completionsUsed)).toBe(12);
  await page.getByRole("link", { name: "Optimize", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await expect(page.getByText("12 completions · Claude Sonnet 4.5")).toBeVisible();
  expect(await page.evaluate(() => window.optimizationStream.requests)).toBe(1);
});

test("Cancel still aborts after switching tabs and a new run can finish", async ({ page }) => {
  await controlStream(page);
  await page.goto("/");
  await startRun(page);
  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await page.getByRole("link", { name: "Optimize", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.optimizationStream.aborted)).toBe(1);

  await startRun(page);
  await page.evaluate(() => window.optimizationStream.finish());
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  expect(await page.evaluate(() => window.optimizationStream.requests)).toBe(2);
});

test("loading an example preserves an active run and replaces the prompt after it finishes", async ({ page }) => {
  await controlStream(page);
  await page.goto("/");
  await startRun(page);
  await page.getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example prompts" })).toBeVisible();
  const examplePrompt = await page.locator("article#few_shot pre").textContent();
  await page.getByRole("link", { name: "Use Few-Shot Pattern example", exact: true }).click();

  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
  await expect(page.getByText("Finish or cancel the current optimization before loading an example.").first()).toBeVisible();
  expect(await page.evaluate(() => window.optimizationStream.aborted)).toBe(0);
  expect(await page.evaluate(() => window.optimizationStream.requests)).toBe(1);

  await page.evaluate(() => window.optimizationStream.finish());
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible();
  await page.getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example prompts" })).toBeVisible();
  await page.getByRole("link", { name: "Use Few-Shot Pattern example", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(examplePrompt!);
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.optimizationStream.requests)).toBe(1);
});
