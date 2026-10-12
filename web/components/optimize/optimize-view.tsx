"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/optimize/confirm-dialog";
import { ProgressPanel } from "@/components/optimize/progress-panel";
import { PromptForm } from "@/components/optimize/prompt-form";
import { ResultPanel } from "@/components/optimize/result-panel";
import { REWRITE, useOptimizeSession } from "@/components/optimize/optimize-session-provider";
import { getDesignExample } from "@/lib/design-examples";
import { getPatternExample } from "@/lib/pattern-examples";
import { MAX_PLAN_PATTERNS } from "@/lib/arc-core/core/index.js";

export function OptimizeView() {
  const router = useRouter();
  const {
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
    canRun,
    effectiveJudge,
    refineSettings,
    currentModelLabel,
    cancelRun,
    startRun,
  } = useOptimizeSession();

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("example");
    const design = params.get("design");
    const example = (name ? getPatternExample(name) : undefined) ?? (design ? getDesignExample(design) : undefined);
    if (example) {
      loadExample(example.prompt);
      router.replace("/", { scroll: false });
    }
  }, [hydrated, loadExample, router]);

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Optimize a prompt</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          Paste a prompt. The model you pick rewrites it with a role, format, and constraints, and plans objective checks for the task. The optimizer
          runs the baseline, the rewrite, and up to {MAX_PLAN_PATTERNS} pattern variants chosen for the task, scores every output against those checks,
          revises the rewrite for any check it fails, and ranks the result.
        </p>
      </div>

      <PromptForm
        prompt={prompt}
        onPromptChange={setPrompt}
        context={context}
        onContextChange={setContext}
        useCase={useCase}
        onUseCaseChange={setUseCase}
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
        refine={refine}
        refineAvailable={refineAvailable}
        onRefineChange={setRefine}
        canRun={canRun}
        onRequestRun={() => setPhase("confirm")}
      />

      {phase === "running" ? (
        <ProgressPanel modelLabel={currentModelLabel} state={stepState} onCancel={cancelRun} />
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
        rewrite={REWRITE}
        refine={refineSettings}
        onCancel={() => setPhase(result ? "done" : "idle")}
        onRun={() => void startRun()}
      />
    </main>
  );
}
