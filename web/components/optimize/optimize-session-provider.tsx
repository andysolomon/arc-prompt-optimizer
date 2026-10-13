"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RunCancelledError, RunUnavailableError, discardRun, followRun, startRun as startServerRun } from "@/lib/client/runs";
import { defaultSelectionId } from "@/lib/client/selection";
import { prepareImage, type LocalAttachment } from "@/lib/client/images";
import { advanceSteps, planSteps, type StepState } from "@/lib/client/steps";
import { modelAcceptsImages, modelLabel } from "@/lib/models";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_PROMPT_CHARACTERS,
  MAX_REWRITE_DETAIL_CHARACTERS,
  REFINE_DEFAULT_ROUNDS,
  REFINE_DEFAULT_VARIANTS,
  type ModelInfo,
  type ModelsResponse,
  type OptimizeResult,
  type RefineSettings,
} from "@/lib/types";

const SESSION_KEY = "arc-po-session";
/** The run in progress, kept in localStorage so a reload, a backgrounded tab, or a new tab can pick it back up. */
const ACTIVE_RUN_KEY = "arc-po-active-run";
/** Runs older than this are not resumed: the server bounds a run at 300 s and keeps its result for 30 minutes. */
export const RESUME_WINDOW_MS = 10 * 60 * 1000;
/** The model rewrites every prompt before the run; the API also accepts `rewrite: false`. */
export const REWRITE = true;

type Phase = "idle" | "confirm" | "running" | "done";

interface PersistedSession {
  prompt: string;
  context: string;
  useCase: string;
  model: string;
  judge: boolean;
  refine: boolean;
  result: OptimizeResult | null;
  selectedId: string | null;
  edited: Record<string, string>;
  attachments: LocalAttachment[];
}

function isLocalAttachment(value: unknown): value is LocalAttachment {
  const entry = value as Partial<LocalAttachment> | null;
  return typeof entry === "object" && entry !== null && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.type === "string" && typeof entry.data === "string" && typeof entry.bytes === "number";
}

interface ActiveRun {
  id: string;
  startedAt: number;
  model: string;
  judge: boolean;
  refineRounds: number;
}

function loadActiveRun(now = Date.now()): ActiveRun | undefined {
  try {
    const raw = localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ActiveRun>;
    if (typeof parsed.id !== "string" || typeof parsed.startedAt !== "number") return undefined;
    if (now - parsed.startedAt > RESUME_WINDOW_MS) return undefined;
    return {
      id: parsed.id,
      startedAt: parsed.startedAt,
      model: typeof parsed.model === "string" ? parsed.model : "",
      judge: typeof parsed.judge === "boolean" ? parsed.judge : false,
      refineRounds: typeof parsed.refineRounds === "number" ? parsed.refineRounds : 0,
    };
  } catch {
    return undefined;
  }
}

function saveActiveRun(run: ActiveRun | null): void {
  try {
    if (run === null) localStorage.removeItem(ACTIVE_RUN_KEY);
    else localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
  } catch {
    /* storage unavailable */
  }
}

function loadSession(): PersistedSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    return {
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      context: typeof parsed.context === "string" ? parsed.context : "",
      useCase: typeof parsed.useCase === "string" ? parsed.useCase : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      judge: typeof parsed.judge === "boolean" ? parsed.judge : true,
      refine: typeof parsed.refine === "boolean" ? parsed.refine : false,
      // Results saved by earlier versions lack the rewrite, plan, revision, loop, and refine reports.
      result: parsed.result
        ? {
            ...parsed.result,
            rewrite: parsed.result.rewrite ?? { status: "not_requested" },
            plan: parsed.result.plan ?? { status: "default", reason: "This result predates planned checks.", suiteId: "prompt-optimize-preview", patterns: [] },
            revisions: parsed.result.revisions ?? [],
            loop: parsed.result.loop ?? { rounds: 0, stoppedBecause: "not_requested" },
            refine: parsed.result.refine ?? { status: "not_requested" },
          }
        : null,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
      edited: parsed.edited ?? {},
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter(isLocalAttachment) : [],
    };
  } catch {
    return undefined;
  }
}

function useSessionState() {
  const [hydrated, setHydrated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [useCase, setUseCase] = useState("");
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState(true);
  const [refine, setRefine] = useState(false);
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [judgeAvailable, setJudgeAvailable] = useState(false);
  const [refineAvailable, setRefineAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepState, setStepState] = useState<StepState>(() => planSteps(true, REWRITE));
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const [pendingResume, setPendingResume] = useState<ActiveRun | null>(null);

  // Restore the last prompt and result from sessionStorage so a refresh does not lose them.
  useEffect(() => {
    const session = loadSession();
    const active = loadActiveRun();
    if (active) setPendingResume(active);
    else saveActiveRun(null);
    if (session) {
      setPrompt(session.prompt);
      setContext(session.context);
      setUseCase(session.useCase);
      setModel(session.model);
      setJudge(session.judge);
      setRefine(session.refine);
      setResult(session.result);
      setSelectedId(session.selectedId);
      setEdited(session.edited);
      setAttachments(session.attachments);
      if (session.result && !active) setPhase("done");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const session: PersistedSession = { prompt, context, useCase, model, judge, refine, result, selectedId, edited, attachments };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        // Images can exceed the storage quota; keep everything else rather than nothing.
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, attachments: [] }));
      }
    } catch {
      /* storage unavailable or full */
    }
  }, [hydrated, prompt, context, useCase, model, judge, refine, result, selectedId, edited, attachments]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<ModelsResponse>) : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        setModels(data.models);
        setJudgeAvailable(data.judgeAvailable);
        setRefineAvailable(data.refineAvailable ?? false);
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
  const detailsWithinLimit = context.length <= MAX_REWRITE_DETAIL_CHARACTERS && useCase.length <= MAX_REWRITE_DETAIL_CHARACTERS;
  const imagesAccepted = modelAcceptsImages(model);
  /** Why the attached images block a run, or undefined when they do not. */
  const attachmentIssue =
    attachments.length === 0 ? undefined : !imagesAccepted ? `${modelLabel(model)} does not accept images. Pick a vision model or remove the images.` : undefined;
  const canRun = !trimmedEmpty && prompt.length <= MAX_PROMPT_CHARACTERS && detailsWithinLimit && phase !== "running" && model !== "" && attachmentIssue === undefined;
  const effectiveJudge = judge && judgeAvailable;
  // The refine loop iterates on Jev scores, so it is only offered alongside the judge.
  const effectiveRefine = refine && refineAvailable && effectiveJudge;
  const refineSettings = useMemo<RefineSettings | undefined>(
    () => (effectiveRefine ? { rounds: REFINE_DEFAULT_ROUNDS, variants: REFINE_DEFAULT_VARIANTS } : undefined),
    [effectiveRefine],
  );
  const currentModelLabel = modelLabel(model);

  /**
   * Follows a run on the server until it finishes. The run itself is not tied to this page: closing the tab or
   * switching apps only pauses the polling, and the run is picked up again from localStorage on return.
   */
  const follow = useCallback(
    async (run: ActiveRun) => {
      if (controllerRef.current !== null) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setPhase("running");
      try {
        const next = await followRun(run.id, controller.signal, (event) => {
          if (!controller.signal.aborted) setStepState((state) => advanceSteps(state, event));
        });
        if (controller.signal.aborted) return;
        saveActiveRun(null);
        void discardRun(run.id);
        setResult(next);
        setSelectedId(defaultSelectionId(next));
        // A run resumed in a fresh tab has no prompt in this tab's session; the baseline candidate is the prompt as submitted.
        setPrompt((current) => (current.trim() === "" ? (next.candidates[0]?.prompt.text ?? current) : current));
        setPhase("done");
        if (next.rewrite.status === "failed") toast.warning(`The rewrite failed after ${next.rewrite.attempts} ${next.rewrite.attempts === 1 ? "attempt" : "attempts"}; ranking the baseline and ${next.candidates.length - 1} pattern variants instead.`);
        if (run.judge && next.judge.status === "failed") toast.warning("Jev judging failed; showing the deterministic ranking.");
        if (run.refineRounds > 0 && next.refine.status === "failed") toast.warning(`Refining failed; showing the first-pass ranking. ${next.refine.reason}`);
      } catch (error) {
        if (controller.signal.aborted) return;
        saveActiveRun(null);
        if (error instanceof RunCancelledError) toast.info("The run was cancelled.");
        else if (error instanceof RunUnavailableError) toast.error(error.message);
        else toast.error(error instanceof Error ? error.message : "Optimization failed.");
        if (!(error instanceof RunUnavailableError)) void discardRun(run.id);
        setPhase("idle");
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [],
  );

  // Pick up a run that was in progress when this page was last unloaded.
  useEffect(() => {
    if (!hydrated || pendingResume === null) return;
    setPendingResume(null);
    setStepState(planSteps(pendingResume.judge, REWRITE, pendingResume.refineRounds));
    setResult(null);
    setSelectedId(null);
    setEdited({});
    if (pendingResume.model !== "") setModel((current) => (current === "" ? pendingResume.model : current));
    void follow(pendingResume);
  }, [follow, hydrated, pendingResume]);

  const cancelRun = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const active = loadActiveRun();
    saveActiveRun(null);
    if (active) void discardRun(active.id);
    setPhase(result ? "done" : "idle");
  }, [result]);

  const addAttachments = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return;
      const prepared: LocalAttachment[] = [];
      for (const file of files) {
        try {
          prepared.push(await prepareImage(file));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : `Could not attach ${file.name}.`);
        }
      }
      if (prepared.length === 0) return;
      setAttachments((current) => {
        const next = [...current];
        for (const attachment of prepared) {
          if (next.length >= MAX_ATTACHMENTS) {
            toast.warning(`At most ${MAX_ATTACHMENTS} images can be attached.`);
            break;
          }
          if (next.reduce((sum, entry) => sum + entry.bytes, 0) + attachment.bytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
            toast.warning(`Attached images must total at most ${(MAX_ATTACHMENTS_TOTAL_BYTES / 1_000_000).toFixed(0)} MB; ${attachment.name} was not added.`);
            continue;
          }
          next.push(attachment);
        }
        return next;
      });
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const loadExample = useCallback((text: string) => {
    if (controllerRef.current !== null) {
      toast.warning("Finish or cancel the current optimization before loading an example.");
      return;
    }
    setPrompt(text);
    setAttachments([]);
    setResult(null);
    setSelectedId(null);
    setEdited({});
    setPhase("idle");
  }, []);

  /** Clears the prompt, the rewrite details, and the previous result to start over. */
  const startNewPrompt = useCallback(() => {
    if (controllerRef.current !== null) {
      toast.warning("Finish or cancel the current optimization before starting a new prompt.");
      return;
    }
    setPrompt("");
    setContext("");
    setUseCase("");
    setAttachments([]);
    setResult(null);
    setSelectedId(null);
    setEdited({});
    setPhase("idle");
  }, []);

  const startRun = useCallback(async () => {
    if (controllerRef.current !== null) return;
    const judgeForRun = effectiveJudge;
    const refineForRun = refineSettings;
    setStepState(planSteps(judgeForRun, REWRITE, refineForRun?.rounds ?? 0));
    setPhase("running");
    setResult(null);
    setSelectedId(null);
    setEdited({});
    let id: string;
    try {
      id = await startServerRun({
        prompt,
        model: model as OptimizeResult["model"],
        judge: judgeForRun,
        rewrite: REWRITE,
        ...(context.trim() === "" ? {} : { context }),
        ...(useCase.trim() === "" ? {} : { useCase }),
        ...(refineForRun === undefined ? {} : { refine: refineForRun }),
        ...(attachments.length === 0 ? {} : { attachments: attachments.map(({ name, type, data }) => ({ name, type, data })) }),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Optimization failed.");
      setPhase("idle");
      return;
    }
    const run: ActiveRun = { id, startedAt: Date.now(), model, judge: judgeForRun, refineRounds: refineForRun?.rounds ?? 0 };
    saveActiveRun(run);
    await follow(run);
  }, [attachments, context, effectiveJudge, follow, model, prompt, refineSettings, useCase]);

  return {
    hydrated,
    loadExample,
    prompt,
    setPrompt,
    context,
    setContext,
    useCase,
    setUseCase,
    model,
    setModel,
    judge,
    setJudge,
    refine,
    setRefine,
    models,
    modelsLoaded,
    judgeAvailable,
    refineAvailable,
    phase,
    setPhase,
    stepState,
    result,
    selectedId,
    setSelectedId,
    edited,
    setEdited,
    attachments,
    addAttachments,
    removeAttachment,
    imagesAccepted,
    attachmentIssue,
    canRun,
    effectiveJudge,
    refineSettings,
    currentModelLabel,
    cancelRun,
    startRun,
    startNewPrompt,
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
