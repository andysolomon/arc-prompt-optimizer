"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { progressPercent } from "@/lib/client/steps";
import { cn } from "@/lib/utils";

export function ProgressPanel({
  modelLabel,
  steps,
  doneCount,
  onCancel,
}: {
  modelLabel: string;
  steps: readonly string[];
  doneCount: number;
  onCancel: () => void;
}) {
  const percent = progressPercent(doneCount, steps.length);
  return (
    <section aria-label="Progress" aria-live="polite" className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">Running {modelLabel}</div>
        <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-[13px]" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Progress value={percent} aria-label="Run progress" className="h-1 bg-muted" />
      <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        {steps.map((label, index) => {
          const done = index < doneCount;
          const active = index === doneCount;
          return (
            <li key={label} className={cn("flex items-center gap-2.5", done || active ? "text-foreground" : "text-muted-foreground")}>
              <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {done ? (
                  <Check className="size-3.5" strokeWidth={2.5} />
                ) : active ? (
                  <span className="inline-block size-3 rounded-full border-2 border-border border-t-foreground [animation:arc-spin_.8s_linear_infinite]" />
                ) : (
                  <span className="inline-block size-1.5 rounded-full bg-border" />
                )}
              </span>
              <span>
                {label}
                <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : " (pending)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
