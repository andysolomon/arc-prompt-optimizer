import { expect, test } from "@playwright/test";

const PROMPT = "Write alt text for this image.";
// A 2×2 red PNG; small enough that the browser sends it as is.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEIGGEMAD7CBAG0ZVjRAAAAAElFTkSuQmCC", "base64");

test("attach an image, see it on the result, and send it with the run", async ({ page }) => {
  let body: { attachments?: { name: string; type: string; data: string }[] } | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/api/optimize/runs") && request.method() === "POST") body = request.postDataJSON();
  });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Model" })).toContainText("Claude Sonnet 4.5");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(PROMPT);
  await expect(page.getByText("Up to 3 images, sent with every completion.")).toBeVisible();
  await page.getByLabel("Image files").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  const attachment = page.getByTestId("attachment");
  await expect(attachment).toHaveCount(1);
  await expect(attachment).toContainText("logo.png");
  await expect(attachment).toContainText("2×2");
  await expect(page.getByText("1 of 3 images attached.")).toBeVisible();

  // A file that is not an image is reported and not attached.
  await page.getByLabel("Image files").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("notes.txt is not a JPEG, PNG, WebP, or GIF image.")).toBeVisible();
  await expect(attachment).toHaveCount(1);

  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Run optimization?" });
  await expect(dialog).toContainText("1 image, sent with every completion");
  await dialog.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This image was sent with every completion.")).toBeVisible();
  expect(body?.attachments).toHaveLength(1);
  expect(body?.attachments?.[0]).toMatchObject({ name: "logo.png", type: "image/png", data: PNG.toString("base64") });

  // The attachment survives a reload with the result and can be removed for the next run.
  await page.reload();
  await expect(page.getByTestId("attachment")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove logo.png" }).click();
  await expect(page.getByTestId("attachment")).toHaveCount(0);
});

test("a text-only model refuses images and the run is blocked until they are removed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(PROMPT);
  await page.getByLabel("Image files").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("attachment")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByRole("option", { name: "MiniMax M3" }).click();
  await expect(page.getByTestId("attachment-issue")).toContainText("MiniMax M3 does not accept images.");
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Attach images" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove logo.png" }).click();
  await expect(page.getByTestId("attachment-issue")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize", exact: true })).toBeEnabled();

  const response = await page.request.post("/api/optimize/runs", { data: { prompt: PROMPT, model: "minimax/MiniMax-M3", judge: false, attachments: [{ name: "logo.png", type: "image/png", data: PNG.toString("base64") }] } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: "Model 'minimax/MiniMax-M3' does not accept image attachments." });
});
