"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COMPLETION_COUNT } from "@/lib/types";

export const CONFIRM_BODY =
  "Nothing calls a model until you confirm. The run produces one completion per candidate: the source baseline plus three pattern variants. Nothing is submitted on your behalf, and the result is returned to you only.";

export function ConfirmDialog({
  open,
  modelLabel,
  judge,
  onCancel,
  onRun,
}: {
  open: boolean;
  modelLabel: string;
  judge: boolean;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-[440px] gap-4 rounded-xl p-6">
        <DialogHeader className="gap-1.5 space-y-0 text-left">
          <DialogTitle className="text-[17px] font-semibold">Run optimization?</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-pretty">{CONFIRM_BODY}</DialogDescription>
        </DialogHeader>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="m-0">{modelLabel}</dd>
          <dt className="text-muted-foreground">Completions</dt>
          <dd className="m-0">{COMPLETION_COUNT}</dd>
          <dt className="text-muted-foreground">Judge</dt>
          <dd className="m-0">{judge ? "Jev (TypeSafe) · 1 request, 4 Score questions" : "Deterministic checks only"}</dd>
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
