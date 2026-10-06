import { expect, test } from "@playwright/test";

const PROMPT = "Summarize this incident report for executives.";

test("paste prompt → confirm → result renders with four candidates", async ({ page }) => {
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
  await expect(dialog).toContainText("Completions");
  await expect(dialog.getByText("4", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Run" }).click();

  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("4 completions · Claude Sonnet 4.5")).toBeVisible();

  await page.getByRole("button", { name: "See all candidates (4)" }).click();
  const rows = page.getByTestId("candidate-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("selected");
  await expect(page.getByText("Jev", { exact: false }).first()).toBeVisible();

  // "Use this" swaps the selected card.
  await rows.nth(1).getByRole("button", { name: /^Use / }).click();
  await expect(rows.nth(1)).toContainText("selected");

  // Edit → Save marks the candidate as edited.
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByLabel("Edit candidate prompt");
  await editor.fill(`${PROMPT}\nAdd a one-line risk summary.`);
  await page.getByRole("button", { name: "Save" }).click();
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
  await expect(page.getByText("preview", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Structured Reasoning Pattern")).toBeVisible();
});

test("rejects an invalid request body with 400", async ({ request }) => {
  const response = await request.post("/api/optimize", { data: { prompt: "", model: "openai/gpt-5-mini", judge: false } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: "Prompt must not be empty." });
});
