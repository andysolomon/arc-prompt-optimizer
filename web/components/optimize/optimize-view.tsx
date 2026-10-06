"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/optimize/confirm-dialog";
import { ProgressPanel } from "@/components/optimize/progress-panel";
import { PromptForm } from "@/components/optimize/prompt-form";
import { ResultPanel } from "@/components/optimize/result-panel";
import { streamOptimize } from "@/lib/client/sse";
import { stepLabels } from "@/lib/client/steps";
import { modelLabel } from "@/lib/models";
import { MAX_PROMPT_CHARACTERS, type ModelInfo, type ModelsResponse, type OptimizeResult } from "@/lib/types";

const SESSION_KEY = "arc-po-session";

type Phase = "idle" | "confirm" | "running" | "done";

interface PersistedSession {
  prompt: string;
  model: string;
  judge: boolean;
  result: OptimizeResult | null;
  selectedId: string | null;
  edited: Record<string, string>;
}

function loadSession(): PersistedSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    return {
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      judge: typeof parsed.judge === "boolean" ? parsed.judge : true,
      result: parsed.result ?? null,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
      edited: parsed.edited ?? {},
    };
  } catch {
    return undefined;
  }
}

export function OptimizeView() {
  const [hydrated, setHydrated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState(true);
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [judgeAvailable, setJudgeAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [doneCount, setDoneCount] = useState(0);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [runJudge, setRunJudge] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  // Restore the last prompt and result from sessionStorage so a refresh does not lose them.
  useEffect(() => {
    const session = loadSession();
    if (session) {
      setPrompt(session.prompt);
      setModel(session.model);
      setJudge(session.judge);
      setResult(session.result);
      setSelectedId(session.selectedId);
      setEdited(session.edited);
      if (session.result) setPhase("done");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const session: PersistedSession = { prompt, model, judge, result, selectedId, edited };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable or full */
    }
  }, [hydrated, prompt, model, judge, result, selectedId, edited]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<ModelsResponse>) : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        setModels(data.models);
        setJudgeAvailable(data.judgeAvailable);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast.error("Could not load the model list.");
        console.error("models request failed", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoaded(true);
      });
    return () => controller.abort();
  }, []);

  // Pick a default model once the list has rendered so the select's options exist before its value changes.
  useEffect(() => {
    if (models.length === 0) return;
    setModel((current) => (models.some((entry) => entry.id === current) ? current : models[0]!.id));
  }, [models]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const trimmedEmpty = prompt.trim().length === 0;
  const canRun = !trimmedEmpty && prompt.length <= MAX_PROMPT_CHARACTERS && phase !== "running" && model !== "";
  const effectiveJudge = judge && judgeAvailable;
  const currentModelLabel = modelLabel(model);

  const cancelRun = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase(result ? "done" : "idle");
  }, [result]);

  const startRun = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const judgeForRun = effectiveJudge;
    setRunJudge(judgeForRun);
    setPhase("running");
    setDoneCount(0);
    setResult(null);
    setSelectedId(null);
    setEdited({});
    try {
      const next = await streamOptimize(
        { prompt, model: model as OptimizeResult["model"], judge: judgeForRun },
        controller.signal,
        () => setDoneCount((count) => count + 1),
      );
      if (controller.signal.aborted) return;
      setResult(next);
      setSelectedId(next.ranking[0]?.candidateId ?? null);
      setPhase("done");
      if (judgeForRun && next.judge.status === "failed") toast.warning("Jev judging failed; showing the deterministic ranking.");
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(error instanceof Error ? error.message : "Optimization failed.");
      setPhase("idle");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [effectiveJudge, model, prompt]);

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Optimize a prompt</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          Paste a prompt. The optimizer renders three pattern variants, runs the baseline and each variant with the model you pick, scores the
          outputs, and ranks them.
        </p>
      </div>

      <PromptForm
        prompt={prompt}
        onPromptChange={setPrompt}
        models={models}
        modelsLoaded={modelsLoaded}
        model={model}
        onModelChange={(value) => {
          // Radix Select echoes "" from its hidden native select when options and value change together.
          if (value) setModel(value);
        }}
        judge={judge}
        judgeAvailable={judgeAvailable}
        onJudgeChange={setJudge}
        canRun={canRun}
        onRequestRun={() => setPhase("confirm")}
      />

      {phase === "running" ? (
        <ProgressPanel modelLabel={currentModelLabel} steps={stepLabels(runJudge)} doneCount={doneCount} onCancel={cancelRun} />
      ) : null}

      {phase === "done" && result ? (
        <ResultPanel
          result={result}
          selectedId={selectedId}
          edited={edited}
          onSelect={setSelectedId}
          onSaveEdit={(id, text) => setEdited((current) => ({ ...current, [id]: text }))}
        />
      ) : null}

      <ConfirmDialog
        open={phase === "confirm"}
        modelLabel={currentModelLabel}
        judge={effectiveJudge}
        onCancel={() => setPhase(result ? "done" : "idle")}
        onRun={() => void startRun()}
      />
    </main>
  );
}
