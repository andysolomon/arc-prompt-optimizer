"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { streamOptimize } from "@/lib/client/sse";
import { defaultSelectionId } from "@/lib/client/selection";
import { advanceSteps, planSteps, type StepState } from "@/lib/client/steps";
import { modelLabel } from "@/lib/models";
import { MAX_PROMPT_CHARACTERS, type ModelInfo, type ModelsResponse, type OptimizeResult } from "@/lib/types";

const SESSION_KEY = "arc-po-session";
/** The model rewrites every prompt before the run; the API also accepts `rewrite: false`. */
export const REWRITE = true;

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
      // Results saved before the rewrite existed have no rewrite report.
      result: parsed.result ? { ...parsed.result, rewrite: parsed.result.rewrite ?? { status: "not_requested" } } : null,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
      edited: parsed.edited ?? {},
    };
  } catch {
    return undefined;
  }
}

function useSessionState() {
  const [hydrated, setHydrated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState(true);
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [judgeAvailable, setJudgeAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepState, setStepState] = useState<StepState>(() => planSteps(true, REWRITE));
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
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

  // The layout owns this request, so page navigation does not cancel it.
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
    if (controllerRef.current !== null) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const judgeForRun = effectiveJudge;
    setStepState(planSteps(judgeForRun, REWRITE));
    setPhase("running");
    setResult(null);
    setSelectedId(null);
    setEdited({});
    try {
      const next = await streamOptimize(
        { prompt, model: model as OptimizeResult["model"], judge: judgeForRun, rewrite: REWRITE },
        controller.signal,
        (event) => {
          if (!controller.signal.aborted) setStepState((state) => advanceSteps(state, event));
        },
      );
      if (controller.signal.aborted) return;
      setResult(next);
      setSelectedId(defaultSelectionId(next));
      setPhase("done");
      if (next.rewrite.status === "failed") toast.warning("The rewrite failed; ranking the other four candidates.");
      if (judgeForRun && next.judge.status === "failed") toast.warning("Jev judging failed; showing the deterministic ranking.");
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(error instanceof Error ? error.message : "Optimization failed.");
      setPhase("idle");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [effectiveJudge, model, prompt]);

  return {
    prompt,
    setPrompt,
    model,
    setModel,
    judge,
    setJudge,
    models,
    modelsLoaded,
    judgeAvailable,
    phase,
    setPhase,
    stepState,
    result,
    selectedId,
    setSelectedId,
    edited,
    setEdited,
    canRun,
    effectiveJudge,
    currentModelLabel,
    cancelRun,
    startRun,
  };
}

const OptimizeSessionContext = createContext<ReturnType<typeof useSessionState> | null>(null);

export function OptimizeSessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionState();
  return <OptimizeSessionContext.Provider value={session}>{children}</OptimizeSessionContext.Provider>;
}

export function useOptimizeSession() {
  const session = useContext(OptimizeSessionContext);
  if (session === null) throw new Error("useOptimizeSession requires OptimizeSessionProvider.");
  return session;
}
