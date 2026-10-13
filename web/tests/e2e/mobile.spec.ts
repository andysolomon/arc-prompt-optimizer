import { expect, test } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEIGGEMAD7CBAG0ZVjRAAAAAElFTkSuQmCC", "base64");

// iOS Safari zooms into a focused field whose font is under 16px; on a touch device every field renders at 16px.
test("text fields render at 16px on a touch device so the browser does not zoom on focus", async ({ page }) => {
  await page.goto("/");
  const fontSize = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).fontSize);
  expect(await fontSize("textarea#prompt")).toBe("16px");
  await page.getByRole("button", { name: "Rewrite details (optional)" }).click();
  expect(await fontSize("textarea#rewrite-use-case")).toBe("16px");
  await page.goto("/library");
  expect(await fontSize('input[type="search"]')).toBe("16px");
  expect(await fontSize("select")).toBe("16px");
});

test("the attach control is a native label for the file input and accepts any image", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Write alt text for this image.");
  const input = page.getByLabel("Image files");
  await expect(input).toHaveAttribute("accept", "image/*");
  // The visible control is the input's label, so activating it opens the picker without a scripted click.
  const label = page.locator('label[for="attach-images"]');
  await expect(label).toHaveText("Attach images");
  expect(await label.evaluate((element) => (element as HTMLLabelElement).control?.id)).toBe("attach-images");
  await input.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("attachment")).toHaveCount(1);
  // The viewport stays at the page width: nothing forces a horizontal scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
