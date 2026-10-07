import { z } from "zod";

export const LIBRARY_KEY = "arc-po-library-v1";
export const MAX_SAVED_PROMPT_CHARACTERS = 48_000;
export const MAX_SAVED_PROMPTS = 500;
export const PROMPT_CATEGORIES = {
  coding: { label: "Coding", description: "Writing, debugging, reviewing, or explaining software and code." },
  writing: { label: "Writing", description: "Drafting, editing, translating, or polishing prose, emails, and documentation." },
  research: { label: "Research", description: "Finding information, investigating a topic, or comparing sources." },
  summarization: { label: "Summarization", description: "Condensing supplied text, documents, or conversations into a summary." },
  analysis: { label: "Analysis", description: "Interpreting data, evaluating evidence, or solving analytical problems." },
  planning: { label: "Planning", description: "Creating plans, schedules, strategies, or step-by-step workflows." },
  creative: { label: "Creative", description: "Brainstorming ideas, storytelling, or creating imaginative content." },
  other: { label: "Other", description: "The primary task does not fit any of the other categories." },
} as const;

export const categorySchema = z.enum(["coding", "writing", "research", "summarization", "analysis", "planning", "creative", "other"]);
export type PromptCategory = z.infer<typeof categorySchema>;
export const savedCategorySchema = z.union([z.literal("uncategorized"), categorySchema]);
export type SavedCategory = z.infer<typeof savedCategorySchema>;
export const categorySuggestionSchema = z.object({
  category: categorySchema,
  confidence: z.number().min(0).max(1),
  model: z.string().min(1),
});
export type CategorySuggestion = z.infer<typeof categorySuggestionSchema>;

export const promptDraftSchema = z.object({
  title: z.string().trim().min(1, "Give this prompt a title.").max(120),
  prompt: z.string().max(MAX_SAVED_PROMPT_CHARACTERS).refine((text) => text.trim().length > 0, "Prompt must not be empty."),
  category: savedCategorySchema,
  suggestion: categorySuggestionSchema.optional(),
});
export type PromptDraft = z.infer<typeof promptDraftSchema>;
export const savedPromptSchema = promptDraftSchema.extend({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SavedPrompt = z.infer<typeof savedPromptSchema>;
export const promptLibrarySchema = z.object({
  version: z.literal(1),
  prompts: z.array(savedPromptSchema).max(MAX_SAVED_PROMPTS).refine((prompts) => new Set(prompts.map((prompt) => prompt.id)).size === prompts.length, "Duplicate prompt IDs."),
});

export function categoryLabel(category: SavedCategory): string {
  return category === "uncategorized" ? "Uncategorized" : PROMPT_CATEGORIES[category].label;
}

export function readPromptLibrary(storage: Pick<Storage, "getItem">): SavedPrompt[] {
  const raw = storage.getItem(LIBRARY_KEY);
  return raw ? promptLibrarySchema.parse(JSON.parse(raw)).prompts : [];
}

/** Write before updating the UI so a failed storage write never looks like a successful save. */
export function writePromptLibrary(storage: Pick<Storage, "setItem">, prompts: SavedPrompt[]): void {
  storage.setItem(LIBRARY_KEY, JSON.stringify(promptLibrarySchema.parse({ version: 1, prompts })));
}

/** Import adds missing IDs and preserves existing records, including local edits. */
export function mergePromptLibraries(current: SavedPrompt[], incoming: SavedPrompt[]): SavedPrompt[] {
  const existing = new Set(current.map((prompt) => prompt.id));
  return promptLibrarySchema.parse({ version: 1, prompts: [...incoming.filter((prompt) => !existing.has(prompt.id)), ...current] }).prompts;
}
