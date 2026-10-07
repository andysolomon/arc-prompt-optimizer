import { expect, test } from "@playwright/test";
import { listPatterns } from "../../lib/arc-core/core/index.js";
import { PATTERN_EXAMPLES } from "../../lib/pattern-examples";

const PROMPT = "Summarize this incident report for executives.";

test("paste prompt → confirm → result renders with the rewrite and every catalog pattern", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Optimize a prompt" })).toBeVisible();

  const optimize = page.getByRole("button", { name: "Optimize", exact: true });
  await expect(optimize).toBeDisabled();

  await page.getByRole("textbox", { name: "Prompt" }).fill(PROMPT);
  await expect(page.getByText(`${PROMPT.length} characters`)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Model" })).toContainText("Claude Sonnet 4.5");
  await expect(optimize).toBeEnabled();

  await optimize.click();
  const dialog = page.getByRole("dialog", { name: "Run optimization?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nothing calls a model until you confirm.");
  await expect(dialog).toContainText("The model first rewrites your prompt");
  await expect(dialog).toContainText("Completions");
  await expect(dialog.getByText("12", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("1 request, 11 Score questions");
  await dialog.getByRole("button", { name: "Run" }).click();

  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("12 completions · Claude Sonnet 4.5")).toBeVisible();

  await page.getByRole("button", { name: "See all candidates (11)" }).click();
  const rows = page.getByTestId("candidate-row");
  await expect(rows).toHaveCount(11);
  for (const pattern of listPatterns()) {
    await expect(rows.filter({ hasText: new RegExp(`${pattern.name}-[0-9a-f]{8}`, "u") })).toHaveCount(1);
  }
  await expect(rows.first()).toContainText("selected");
  const rewriteRow = rows.filter({ hasText: "Rewrite" });
  await expect(rewriteRow).toHaveCount(1);
  await expect(rewriteRow).toContainText(/rewrite-[0-9a-f]{8}/u);

  // Selecting the rewrite shows the rewritten prompt and why it changed.
  if (!(await rewriteRow.textContent())?.includes("selected")) await rewriteRow.getByRole("button", { name: /^Use / }).click();
  await expect(page.getByTestId("best-prompt")).toContainText("You are a senior analyst");
  await page.getByRole("button", { name: /Why it was rewritten \(3 changes\)/u }).click();
  await expect(page.getByText("Added a specific role to set the register.")).toBeVisible();
  await expect(page.getByText("No role or audience is stated.")).toBeVisible();
  await expect(page.getByText("Jev", { exact: false }).first()).toBeVisible();

  // "Use this" swaps the selected card.
  const baselineRow = rows.filter({ hasText: "Baseline" });
  await baselineRow.getByRole("button", { name: /^Use / }).click();
  await expect(baselineRow).toContainText("selected");

  // Edit → Save marks the candidate as edited.
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByLabel("Edit candidate prompt");
  await editor.fill(`${PROMPT}\nAdd a one-line risk summary.`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("edited").first()).toBeVisible();

  // Refresh keeps the result.
  await page.reload();
  await expect(page.getByRole("heading", { name: /candidate$/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(PROMPT);
});

test("patterns page lists all nine catalog patterns", async ({ page }) => {
  await page.goto("/patterns");
  await expect(page.getByRole("heading", { name: "Pattern catalog" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(9);
  await expect(page.getByText("used in Optimize", { exact: true })).toHaveCount(9);
  await expect(page.getByText("Structured Reasoning Pattern")).toBeVisible();
});

test("rejects an invalid request body with 400", async ({ request }) => {
  const response = await request.post("/api/optimize", { data: { prompt: "", model: "openai/gpt-5-mini", judge: false } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: "Prompt must not be empty." });
});

test("examples cover every pattern and load into Optimize without submitting", async ({ page }) => {
  let optimizationRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/optimize")) optimizationRequests += 1;
  });
  await page.goto("/examples");
  await expect(page.getByRole("heading", { name: "Example prompts" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(PATTERN_EXAMPLES.length);
  for (const example of PATTERN_EXAMPLES) {
    await expect(page.locator(`article#${example.pattern} pre`)).toHaveText(example.prompt);
  }
  const example = PATTERN_EXAMPLES.find((entry) => entry.pattern === "few_shot")!;
  await page.getByRole("link", { name: "Use Few-Shot Pattern example", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(example.prompt);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();
  expect(optimizationRequests).toBe(0);
  // Wait for the example query to be consumed before a reload can reapply it.
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("textbox", { name: "Prompt" }).fill("My edited example");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue("My edited example");
});
