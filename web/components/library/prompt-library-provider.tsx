"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LIBRARY_KEY, mergePromptLibraries, promptDraftSchema, readPromptLibrary, writePromptLibrary, type PromptDraft, type SavedPrompt } from "@/lib/prompt-library";

function useLibraryState() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => {
      try {
        setPrompts(readPromptLibrary(localStorage));
        setError(null);
      } catch {
        setError("The prompt library could not be read. Check that browser storage is available. Existing data has been preserved.");
      }
      setReady(true);
    };
    load();
    const sync = (event: StorageEvent) => { if (event.key === LIBRARY_KEY || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const change = useCallback((update: (current: SavedPrompt[]) => SavedPrompt[]) => {
    if (!ready || error) throw new Error("The prompt library is unavailable.");
    try {
      // Read the latest value so changes in another tab are not overwritten.
      const next = update(readPromptLibrary(localStorage));
      writePromptLibrary(localStorage, next);
      setPrompts(next);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "This prompt no longer exists.") throw cause;
      throw new Error("Could not save the library. Browser storage may be full or unavailable.");
    }
  }, [ready, error]);

  const save = useCallback((draft: PromptDraft, id?: string) => {
    const parsed = promptDraftSchema.parse(draft);
    const now = new Date().toISOString();
    change((current) => {
      const previous = id ? current.find((prompt) => prompt.id === id) : undefined;
      if (id && !previous) throw new Error("This prompt no longer exists.");
      const saved: SavedPrompt = { ...parsed, id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now };
      return [saved, ...current.filter((prompt) => prompt.id !== saved.id)];
    });
  }, [change]);
  const remove = useCallback((id: string) => change((current) => current.filter((prompt) => prompt.id !== id)), [change]);
  const importPrompts = useCallback((incoming: SavedPrompt[]) => change((current) => mergePromptLibraries(current, incoming)), [change]);
  return { prompts, ready, error, save, remove, importPrompts };
}

const LibraryContext = createContext<ReturnType<typeof useLibraryState> | null>(null);
export function PromptLibraryProvider({ children }: { children: ReactNode }) {
  const library = useLibraryState();
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>;
}
export function usePromptLibrary() {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("usePromptLibrary requires PromptLibraryProvider.");
  return library;
}
