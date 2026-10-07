import { describe, expect, it } from "vitest";
import { LIBRARY_KEY, MAX_SAVED_PROMPTS, mergePromptLibraries, promptLibrarySchema, readPromptLibrary, writePromptLibrary, type SavedPrompt } from "@/lib/prompt-library";

const saved: SavedPrompt = { id: "15c87c30-bdaa-4b2b-b513-1ded39712a22", title: "Incident summary", prompt: "Summarize this report.\nKeep the exact whitespace.  ", category: "summarization", createdAt: "2026-10-07T12:00:00.000Z", updatedAt: "2026-10-07T12:00:00.000Z" };

describe("prompt library persistence", () => {
  it("round-trips the full text, category and Jev provenance", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const prompt = { ...saved, suggestion: { category: "summarization" as const, confidence: 0.8, model: "jev-1" } };
    expect(readPromptLibrary(storage)).toEqual([]);
    writePromptLibrary(storage, [prompt]);
    expect(readPromptLibrary(storage)).toEqual([prompt]);
    expect(values.has(LIBRARY_KEY)).toBe(true);
  });

  it("does not hide corrupt or unavailable storage and propagates quota errors", () => {
    expect(() => readPromptLibrary({ getItem: () => "broken" })).toThrow();
    expect(() => readPromptLibrary({ getItem: () => '{"version":2,"prompts":[]}' })).toThrow();
    expect(() => writePromptLibrary({ setItem: () => { throw new Error("Quota exceeded"); } }, [saved])).toThrow("Quota exceeded");
  });

  it("merges backups without losing local edits or duplicating IDs", () => {
    const local = { ...saved, title: "Edited locally" };
    const added = { ...saved, id: "85daf3c8-3574-4f02-af0e-2f3c2f629f99" };
    expect(mergePromptLibraries([local], [saved, added])).toEqual([added, local]);
    expect(promptLibrarySchema.safeParse({ version: 1, prompts: [saved, saved] }).success).toBe(false);
    expect(promptLibrarySchema.safeParse({ version: 1, prompts: [{ ...saved, category: "invented" }] }).success).toBe(false);
    expect(promptLibrarySchema.safeParse({ version: 1, prompts: Array(MAX_SAVED_PROMPTS + 1).fill(saved) }).success).toBe(false);
  });
});
