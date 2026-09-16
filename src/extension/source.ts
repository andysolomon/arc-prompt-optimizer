import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Matches the CLI prompt limit so extension and CLI accept the same drafts. */
export const MAX_EXTENSION_PROMPT_CHARACTERS = 16_384;

export const SOURCE_LABEL_COMMAND = "command input";
export const SOURCE_LABEL_EDITOR = "editor draft";
export const SOURCE_LABEL_USER_MESSAGE = "latest user message";

export interface PromptSource {
  readonly label: string;
  readonly text: string;
}

/** Structural view of session branch entries; only user message text is read. */
export interface BranchEntryLike {
  readonly type: string;
  readonly message?: { readonly role?: string; readonly content?: unknown };
}

export type PromptSourceContext = {
  readonly ui: Pick<ExtensionCommandContext["ui"], "notify" | "select" | "getEditorText">;
  readonly sessionManager: { getBranch(): readonly BranchEntryLike[] };
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block !== null && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

/** Text of the most recent user message on the branch with non-blank text, if any. */
export function latestUserMessageText(branch: readonly BranchEntryLike[]): string | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const text = messageText(entry.message.content);
    if (text.trim() !== "") return text;
  }
  return undefined;
}

/**
 * Pure source collection. Non-blank command args win outright; otherwise the
 * non-blank editor draft and latest user message are offered in that order.
 */
export function collectPromptSources(
  args: string,
  editorText: string,
  branch: readonly BranchEntryLike[],
): readonly PromptSource[] {
  const trimmedArgs = args.trim();
  if (trimmedArgs !== "") return Object.freeze([Object.freeze({ label: SOURCE_LABEL_COMMAND, text: trimmedArgs })]);
  const sources: PromptSource[] = [];
  if (editorText.trim() !== "") sources.push(Object.freeze({ label: SOURCE_LABEL_EDITOR, text: editorText }));
  const userText = latestUserMessageText(branch);
  if (userText !== undefined) sources.push(Object.freeze({ label: SOURCE_LABEL_USER_MESSAGE, text: userText }));
  return Object.freeze(sources);
}

/** Returns an error message when the prompt exceeds the UTF-16 character limit. */
export function promptSizeError(source: PromptSource): string | undefined {
  if (source.text.length <= MAX_EXTENSION_PROMPT_CHARACTERS) return undefined;
  return `The ${source.label} is ${source.text.length} characters; /prompt-optimize accepts at most ${MAX_EXTENSION_PROMPT_CHARACTERS}.`;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

export function promptSourceChoiceLabel(source: PromptSource): string {
  return `${source.label} (${source.text.length} chars): ${preview(source.text)}`;
}

/** Resolves the prompt to optimize, asking only when two sources compete. Returns undefined after reporting why. */
export async function resolvePromptSource(args: string, ctx: PromptSourceContext): Promise<PromptSource | undefined> {
  const sources = collectPromptSources(args, ctx.ui.getEditorText(), ctx.sessionManager.getBranch());
  let source: PromptSource | undefined;
  if (sources.length === 0) {
    ctx.ui.notify(
      "/prompt-optimize needs a prompt: pass it as arguments, type a draft in the editor, or send a user message first.",
      "error",
    );
    return undefined;
  }
  if (sources.length === 1) {
    source = sources[0];
  } else {
    const labels = sources.map(promptSourceChoiceLabel);
    const choice = await ctx.ui.select("Which prompt should be optimized?", labels);
    const index = choice === undefined ? -1 : labels.indexOf(choice);
    source = index === -1 ? undefined : sources[index];
    if (source === undefined) {
      ctx.ui.notify("/prompt-optimize cancelled.", "info");
      return undefined;
    }
  }
  if (source === undefined) return undefined;
  const sizeError = promptSizeError(source);
  if (sizeError !== undefined) {
    ctx.ui.notify(sizeError, "error");
    return undefined;
  }
  return source;
}
