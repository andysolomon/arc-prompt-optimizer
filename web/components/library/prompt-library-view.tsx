"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usePromptLibrary } from "@/components/library/prompt-library-provider";
import { INPUT_CLASS, PromptEditorDialog } from "@/components/library/prompt-editor-dialog";
import { useOptimizeSession } from "@/components/optimize/optimize-session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PROMPT_CATEGORIES, categoryLabel, promptLibrarySchema, type SavedCategory, type SavedPrompt } from "@/lib/prompt-library";
import { MAX_PROMPT_CHARACTERS } from "@/lib/types";

export function PromptLibraryView() {
  const library = usePromptLibrary();
  const { loadExample, phase } = useOptimizeSession();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SavedPrompt | undefined>();
  const [deleting, setDeleting] = useState<SavedPrompt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const available = library.ready && !library.error;
  const search = query.trim().toLowerCase();
  const visible = library.prompts.filter((prompt) => (category === "all" || prompt.category === category) && `${prompt.title}\n${prompt.prompt}\n${categoryLabel(prompt.category)}`.toLowerCase().includes(search));

  const exportLibrary = () => {
    const blob = new Blob([JSON.stringify({ version: 1, prompts: library.prompts }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `arc-prompts-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importLibrary = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("The import file is too large (maximum 32 MB).");
      const parsed = promptLibrarySchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("This file is not a valid Arc prompt library.");
      library.importPrompts(parsed.data.prompts);
      toast.success("Library imported. Existing prompts were preserved.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Import failed."); }
  };

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="space-y-2">
        <h1 className="m-0 text-3xl font-semibold tracking-[-0.025em]">Prompt library</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">Keep prompts for later, organize them by category, and load them into Optimize. Saved prompts stay in this browser; export a backup to move them elsewhere.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!available} onClick={() => { setEditing(undefined); setEditorOpen(true); }}>New prompt</Button>
        <Button variant="outline" disabled={!available || !library.prompts.length} onClick={exportLibrary}>Export</Button>
        <Button variant="outline" disabled={!available} onClick={() => fileRef.current?.click()}>Import</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Import prompt library" className="sr-only" tabIndex={-1} onChange={(event) => void importLibrary(event)} />
        <span className="ml-auto text-xs text-muted-foreground">{library.prompts.length} saved</span>
      </div>
      {!library.ready ? <p role="status">Loading prompts…</p> : null}
      {library.error ? <p role="alert" className="text-sm text-destructive">{library.error}</p> : null}
      {available ? <>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input type="search" aria-label="Search saved prompts" placeholder="Search prompts…" className={`${INPUT_CLASS} flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by category" className={`${INPUT_CLASS} sm:w-48`} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {["uncategorized", ...Object.keys(PROMPT_CATEGORIES)].map((key) => <option key={key} value={key}>{categoryLabel(key as SavedCategory)}</option>)}
          </select>
        </div>
        {visible.length === 0 ? <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{library.prompts.length ? "No prompts match your search or category." : "Your library is empty. Save a draft or an optimized candidate, or create a new prompt here."}</div> : null}
        <div className="flex flex-col gap-4">
          {visible.map((prompt) => <article key={prompt.id} className="rounded-[10px] border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{prompt.title}</h2>
              <span className="rounded-full bg-secondary px-2 py-1 text-xs">{categoryLabel(prompt.category)}</span>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{prompt.prompt}</p>
            {prompt.suggestion ? <p className="mt-2 text-xs text-muted-foreground">Jev category · confidence {prompt.suggestion.confidence.toFixed(2)}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={phase === "running" || prompt.prompt.length > MAX_PROMPT_CHARACTERS} onClick={() => { loadExample(prompt.prompt); router.push("/"); }}>Use in Optimize</Button>
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(prompt.prompt).then(() => toast.success("Copied."), () => toast.error("Copy failed. Open Edit to select the text."))}>Copy</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(prompt); setEditorOpen(true); }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(prompt)}>Delete</Button>
              <span className="ml-auto self-center text-xs text-muted-foreground">Updated {new Date(prompt.updatedAt).toLocaleDateString()}</span>
            </div>
            {prompt.prompt.length > MAX_PROMPT_CHARACTERS ? <p className="mt-2 text-xs text-muted-foreground">Shorten this prompt to {MAX_PROMPT_CHARACTERS.toLocaleString("en-US")} characters in Edit to use it in Optimize.</p> : null}
          </article>)}
        </div>
      </> : null}
      <PromptEditorDialog open={editorOpen} onOpenChange={setEditorOpen} saved={editing} />
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete prompt?</DialogTitle><DialogDescription>“{deleting?.title}” will be removed from this browser’s library.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (!deleting) return;
              try { library.remove(deleting.id); setDeleting(null); toast.success("Prompt deleted."); }
              catch (error) { toast.error(error instanceof Error ? error.message : "Delete failed."); }
            }}>Delete prompt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
