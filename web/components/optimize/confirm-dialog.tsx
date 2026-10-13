"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_PLAN_PATTERNS } from "@/lib/arc-core/core/index.js";
import { MAX_REVISION_ROUNDS, candidateRange, completionRange, refineCompletionCount, type CountRange, type RefineSettings } from "@/lib/types";

export function confirmBody(rewrite: boolean): string {
  return rewrite
    ? `Nothing calls a model until you confirm. The model first rewrites your prompt and plans objective checks for it, then the run produces one completion each for the baseline, the rewrite, and up to ${MAX_PLAN_PATTERNS} pattern variants chosen for the task. If the rewrite's output fails a check, the model revises the prompt and runs it again, up to ${MAX_REVISION_ROUNDS} times. Nothing is submitted on your behalf, and the result is returned to you only.`
    : `Nothing calls a model until you confirm. The run produces one completion per candidate: the source baseline plus up to ${MAX_PLAN_PATTERNS} pattern variants. Nothing is submitted on your behalf, and the result is returned to you only.`;
}

export function formatRange(range: CountRange): string {
  return range.min === range.max ? String(range.min) : `${range.min} to ${range.max}`;
}

export function ConfirmDialog({
  open,
  modelLabel,
  judge,
  rewrite,
  refine,
  attachments = 0,
  onCancel,
  onRun,
}: {
  open: boolean;
  modelLabel: string;
  judge: boolean;
  rewrite: boolean;
  refine?: RefineSettings | undefined;
  /** Images sent with every completion. */
  attachments?: number;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-[440px] gap-4 rounded-xl p-6">
        <DialogHeader className="gap-1.5 space-y-0 text-left">
          <DialogTitle className="text-[17px] font-semibold">Run optimization?</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-pretty">{confirmBody(rewrite)}</DialogDescription>
        </DialogHeader>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="m-0">{modelLabel}</dd>
          {attachments > 0 ? (
            <>
              <dt className="text-muted-foreground">Images</dt>
              <dd className="m-0">
                {attachments} {attachments === 1 ? "image" : "images"}, sent with every completion; the Jev judge sees text only
              </dd>
            </>
          ) : null}
          {rewrite ? (
            <>
              <dt className="text-muted-foreground">Rewrite</dt>
              <dd className="m-0">1 completion (retried once if malformed), then ranked as a candidate</dd>
              <dt className="text-muted-foreground">Revisions</dt>
              <dd className="m-0">up to {MAX_REVISION_ROUNDS}, only while a check fails and time allows</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Completions</dt>
          <dd className="m-0">{refine ? `${formatRange(completionRange(rewrite))}, then up to ${refineCompletionCount(refine)} more while refining` : formatRange(completionRange(rewrite))}</dd>
          <dt className="text-muted-foreground">Judge</dt>
          <dd className="m-0">
            {judge ? `Jev (TypeSafe) · 1 request, ${formatRange(candidateRange(rewrite))} Score questions` : "Deterministic checks only"}
          </dd>
          {refine ? (
            <>
              <dt className="text-muted-foreground">Refine</dt>
              <dd className="m-0">
                {refine.rounds} rounds × {refine.variants} revisions of the top candidate, each judged by Jev
              </dd>
            </>
          ) : null}
        </dl>
        <DialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
          <Button type="button" variant="outline" className="h-9 px-3.5" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" className="h-9 px-3.5" onClick={onRun}>
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
