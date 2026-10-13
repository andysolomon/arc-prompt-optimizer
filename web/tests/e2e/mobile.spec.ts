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

const RUN_FAILURE = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "failed",
  createdAt: Date.now(),
  steps: [{ step: "rewrite", status: "rewritten" }, { step: "render", candidateIds: ["b", "r"], candidateLabels: ["Baseline", "Rewrite"] }],
  error: { kind: "timeout", name: "Error", message: "The baseline candidate failed: Completion timed out after 120000ms." },
};

// A run that fails on the server used to show a four-second toast and reset the form, which a phone that had
// switched apps never saw. The failure now stays on the page, survives a reload, and is reported to the server.
test("a failed run stays explained on the page, survives a reload, and can be retried", async ({ page }) => {
  const reported: unknown[] = [];
  await page.route("**/api/client-events", async (route) => {
    reported.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/optimize/runs?id=*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RUN_FAILURE) });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Summarize this incident report for executives.");
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByRole("option", { name: "GLM-5.3 (OpenCode Go)" }).click();
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();

  const panel = page.getByTestId("run-failure");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("The optimization did not finish");
  await expect(panel).toContainText("The baseline candidate failed: Completion timed out after 120000ms.");
  await expect(panel).toContainText("GLM-5.3 (OpenCode Go) did not answer one completion within the 120 s limit");
  await expect(panel).toContainText("Reached");
  await expect(panel).toContainText("render");
  await expect(page.getByRole("region", { name: "Progress" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("arc-po-active-run"))).toBeNull();
  // Nothing wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => reported.length).toBe(1);
  expect(reported[0]).toMatchObject({ event: "run_failed", kind: "timeout", model: "opencode-go/glm-5.3", lastStep: "render", visibility: "visible" });
  expect(JSON.stringify(reported)).not.toContain("incident report");

  // Long after the toast is gone, and after a reload, the reason is still there.
  await page.reload();
  await expect(page.getByTestId("run-failure")).toContainText("Completion timed out after 120000ms.");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("Summarize this incident report for executives.");

  // Try again goes straight to the confirmation for the same prompt; Dismiss clears the panel.
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Run optimization?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByTestId("run-failure")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("run-failure")).toHaveCount(0);
});

test("a run left behind longer than the server keeps it is reported rather than silently dropped", async ({ page }) => {
  const reported: unknown[] = [];
  await page.route("**/api/client-events", async (route) => {
    reported.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("arc-po-active-run", JSON.stringify({ id: "22222222-2222-4222-8222-222222222222", startedAt: Date.now() - 31 * 60 * 1000, model: "anthropic/claude-sonnet-4-5", judge: true, refineRounds: 0 }));
  });
  await page.reload();
  const panel = page.getByTestId("run-failure");
  await expect(panel).toContainText("A previous optimization was not picked up");
  await expect(panel).toContainText("31 minutes ago");
  await expect(panel).toContainText("22222222-2222-4222-8222-222222222222");
  expect(await page.evaluate(() => localStorage.getItem("arc-po-active-run"))).toBeNull();
  await expect.poll(() => reported.length).toBe(1);
  expect(reported[0]).toMatchObject({ event: "run_abandoned", runId: "22222222-2222-4222-8222-222222222222", model: "anthropic/claude-sonnet-4-5" });
});

test("a run with one failed candidate still shows a ranking and says what did not finish", async ({ page }) => {
  await page.route("**/api/optimize/runs?id=*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const record = (await response.json()) as { status: string; result?: { candidates: { id: string; metadata?: { label?: string } }[]; evaluations: { candidateId: string }[]; ranking: { candidateId: string }[]; failures: unknown[]; judge: { status: string; answers?: Record<string, unknown> } } };
    if (record.status !== "done" || record.result === undefined) return route.fulfill({ response });
    // Turn the last pattern candidate into a timed-out one, as the server would report it.
    const victim = record.result.candidates.at(-1)!;
    const result = {
      ...record.result,
      evaluations: record.result.evaluations.filter((entry) => entry.candidateId !== victim.id),
      ranking: record.result.ranking.filter((entry) => entry.candidateId !== victim.id).map((entry, index) => ({ ...entry, rank: index + 1 })),
      failures: [{ candidateId: victim.id, label: "Critique", error: { kind: "timeout", name: "CompletionTimeoutError", message: "Completion timed out after 60000ms." } }],
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...record, result }) });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Summarize this incident report for executives.");
  await page.getByRole("button", { name: "Optimize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Best candidate" })).toBeVisible({ timeout: 30_000 });
  const notice = page.getByTestId("candidate-failures");
  await expect(notice).toContainText("1 of 4 candidates did not finish");
  await expect(notice).toContainText("Critique: Completion timed out after 60000ms.");
  await page.getByRole("button", { name: "See all candidates (3)" }).click();
  await expect(page.getByTestId("candidate-row")).toHaveCount(3);
});
