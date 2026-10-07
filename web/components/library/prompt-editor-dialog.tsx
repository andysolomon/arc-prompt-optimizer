"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOptimizeSession } from "@/components/optimize/optimize-session-provider";
import { usePromptLibrary } from "@/components/library/prompt-library-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_CATEGORIES, categoryLabel, categorySuggestionSchema, MAX_SAVED_PROMPT_CHARACTERS, promptDraftSchema, type CategorySuggestion, type SavedCategory, type SavedPrompt } from "@/lib/prompt-library";

export const INPUT_CLASS = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PromptEditorDialog({ open, onOpenChange, initialPrompt = "", saved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt?: string;
  saved?: SavedPrompt;
}) {
  const library = usePromptLibrary();
  const { judgeAvailable } = useOptimizeSession();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<SavedCategory>("uncategorized");
  const [suggestion, setSuggestion] = useState<CategorySuggestion | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(saved?.title ?? initialPrompt.trim().split("\n")[0]?.slice(0, 120) ?? "");
      setPrompt(saved?.prompt ?? initialPrompt);
      setCategory(saved?.category ?? "uncategorized");
      setSuggestion(saved?.suggestion);
      setFailure(null);
    }
    return () => { controllerRef.current?.abort(); controllerRef.current = null; setBusy(false); };
  }, [open, initialPrompt, saved]);

  const suggest = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/prompts/categorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }), signal: controller.signal });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Categorization failed.");
      const next = categorySuggestionSchema.parse(body);
      if (controller.signal.aborted) return;
      setSuggestion(next);
      setCategory(next.category);
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : "Categorization failed.");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  };
  const valid = promptDraftSchema.safeParse({ title, prompt, category, suggestion }).success;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{saved ? "Edit saved prompt" : "Save prompt"}</DialogTitle>
          <DialogDescription>Stored in this browser. Choose a category or ask Jev to suggest one.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!valid || busy) return;
          try { library.save({ title, prompt, category, suggestion }, saved?.id); toast.success(saved ? "Prompt updated." : "Prompt saved."); onOpenChange(false); }
          catch (error) { setFailure(error instanceof Error ? error.message : "Save failed."); }
        }}>
          <div className="space-y-2">
            <label htmlFor="saved-title" className="text-sm font-medium">Title</label>
            <input id="saved-title" className={INPUT_CLASS} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-2">
            <label htmlFor="saved-prompt" className="text-sm font-medium">Prompt text</label>
            <Textarea id="saved-prompt" value={prompt} disabled={busy} onChange={(event) => { setPrompt(event.target.value); setSuggestion(undefined); }} className="min-h-40 text-sm" required aria-describedby="saved-prompt-limit" />
            <p id="saved-prompt-limit" className="text-xs text-muted-foreground">{prompt.length.toLocaleString("en-US")} / {MAX_SAVED_PROMPT_CHARACTERS.toLocaleString("en-US")} characters</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="saved-category" className="text-sm font-medium">Category</label>
            <div className="flex flex-wrap gap-2">
              <select id="saved-category" className={`${INPUT_CLASS} min-w-40 flex-1`} value={category} disabled={busy} onChange={(event) => { setCategory(event.target.value as SavedCategory); setSuggestion(undefined); }}>
                <option value="uncategorized">Uncategorized</option>
                {Object.keys(PROMPT_CATEGORIES).map((key) => <option key={key} value={key}>{categoryLabel(key as SavedCategory)}</option>)}
              </select>
              <Button type="button" variant="outline" disabled={!judgeAvailable || busy || !prompt.trim() || prompt.length > MAX_SAVED_PROMPT_CHARACTERS} onClick={() => void suggest()}>{busy ? "Categorizing…" : "Suggest with Jev"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{judgeAvailable ? "Suggest with Jev sends this prompt to TypeSafe for categorization." : "Configure TYPESAFE_API_KEY to enable Jev suggestions."}</p>
            {suggestion ? <p role="status" className="text-xs text-muted-foreground">Jev suggested {categoryLabel(suggestion.category)} · confidence {suggestion.confidence.toFixed(2)}. You can change the category.</p> : null}
          </div>
          {failure ? <p role="alert" className="text-sm text-destructive">{failure}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || busy || !library.ready || Boolean(library.error)}>{saved ? "Save changes" : "Save to library"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SavePromptButton({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const { ready, error } = usePromptLibrary();
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!ready || Boolean(error) || !prompt.trim() || prompt.length > MAX_SAVED_PROMPT_CHARACTERS} onClick={() => setOpen(true)}>Save prompt</Button>
    <PromptEditorDialog open={open} onOpenChange={setOpen} initialPrompt={prompt} />
  </>;
}
