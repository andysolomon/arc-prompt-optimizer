import { describe, expect, it } from "vitest";
import { MAX_PROMPT_CHARACTERS, MODEL_IDS } from "@/lib/types";
import { validateOptimizeBody } from "@/lib/validate";

const all = [...MODEL_IDS];

describe("validateOptimizeBody", () => {
  it("accepts a well-formed request and returns the parsed value unchanged", () => {
    const outcome = validateOptimizeBody({ prompt: "  Summarize this.  ", model: "openai/gpt-5-mini", judge: false }, all);
    expect(outcome).toEqual({ ok: true, value: { prompt: "  Summarize this.  ", model: "openai/gpt-5-mini", judge: false } });
  });

  it("rejects an empty or whitespace-only prompt with 400", () => {
    expect(validateOptimizeBody({ prompt: "", model: all[0], judge: true }, all)).toMatchObject({ ok: false, status: 400, message: "Prompt must not be empty." });
    expect(validateOptimizeBody({ prompt: "   \n", model: all[0], judge: true }, all)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects prompts over the character limit", () => {
    const outcome = validateOptimizeBody({ prompt: "x".repeat(MAX_PROMPT_CHARACTERS + 1), model: all[0], judge: true }, all);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) expect(outcome.message).toMatch(/16,384/u);
    expect(validateOptimizeBody({ prompt: "x".repeat(MAX_PROMPT_CHARACTERS), model: all[0], judge: true }, all).ok).toBe(true);
  });

  it("rejects models outside the allowed list", () => {
    expect(validateOptimizeBody({ prompt: "p", model: "openai/gpt-4o", judge: true }, all)).toMatchObject({ ok: false, status: 400, message: "Model is not in the allowed list." });
  });

  it("rejects allowed models whose provider key is not configured", () => {
    const outcome = validateOptimizeBody({ prompt: "p", model: "google/gemini-2.5-flash", judge: true }, ["openai/gpt-5-mini"]);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) expect(outcome.message).toMatch(/provider key is not configured/u);
  });

  it("rejects malformed bodies and wrong field types", () => {
    expect(validateOptimizeBody(null, all)).toMatchObject({ ok: false, status: 400 });
    expect(validateOptimizeBody("prompt", all)).toMatchObject({ ok: false, status: 400 });
    expect(validateOptimizeBody({ prompt: 42, model: all[0], judge: true }, all)).toMatchObject({ ok: false, status: 400, message: "Prompt must be a string." });
    expect(validateOptimizeBody({ prompt: "p", model: all[0], judge: "yes" }, all)).toMatchObject({ ok: false, status: 400, message: "judge must be a boolean." });
    expect(validateOptimizeBody({ prompt: "p", judge: true }, all)).toMatchObject({ ok: false, status: 400 });
  });
});
