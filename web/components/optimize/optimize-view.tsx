"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/optimize/confirm-dialog";
import { ProgressPanel } from "@/components/optimize/progress-panel";
import { PromptForm } from "@/components/optimize/prompt-form";
import { ResultPanel } from "@/components/optimize/result-panel";
import { REWRITE, useOptimizeSession } from "@/components/optimize/optimize-session-provider";
import { getPatternExample } from "@/lib/pattern-examples";
import { OPTIMIZE_PATTERNS } from "@/lib/pattern-candidates";

export function OptimizeView() {
  const router = useRouter();
  const {
    hydrated,
    loadExample,
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
  } = useOptimizeSession();

  useEffect(() => {
    if (!hydrated) return;
    const name = new URLSearchParams(window.location.search).get("example");
    const example = name ? getPatternExample(name) : undefined;
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
          Paste a prompt. The model you pick rewrites it, the optimizer renders all {OPTIMIZE_PATTERNS.length} pattern variants, runs the baseline and every candidate
          with that model, scores the outputs, and ranks them.
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
        onCancel={() => setPhase(result ? "done" : "idle")}
        onRun={() => void startRun()}
      />
    </main>
  );
}
