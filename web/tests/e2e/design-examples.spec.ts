import { expect, test } from "@playwright/test";
import { DESIGN_EXAMPLES } from "../../lib/design-examples";

const example = DESIGN_EXAMPLES.find((candidate) => candidate.id === "calligraphic-monogram")!;

test("design prompts load into Optimize without a run and save with the Design category preselected", async ({ page }) => {
  let optimizations = 0;
  page.on("request", (request) => { if (request.url().includes("/api/optimize")) optimizations++; });
  await page.goto("/examples");
  await expect(page.getByRole("heading", { name: "Design prompts" })).toBeVisible();
  await page.getByRole("link", { name: "Design", exact: true }).click();
  const card = page.locator("article#design-calligraphic-monogram");
  await expect(card).toContainText("Typography");
  await expect(card.locator("pre")).toHaveText(example.prompt);

  await card.getByRole("button", { name: "Save prompt", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save prompt", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(example.title);
  await expect(dialog.getByRole("combobox", { name: "Category", exact: true })).toHaveValue("design");
  await expect(dialog.getByRole("textbox", { name: "Prompt text" })).toHaveValue(example.prompt);
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect(dialog).toHaveCount(0);

  await card.getByRole("link", { name: `Use ${example.title} design prompt`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Optimize a prompt" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(example.prompt);
  await expect(page.getByRole("dialog", { name: "Run optimization?" })).toHaveCount(0);
  expect(optimizations).toBe(0);

  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: "Filter by category" }).selectOption("design");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText(example.title);
  await expect(page.getByRole("article")).toContainText("Design");
});
