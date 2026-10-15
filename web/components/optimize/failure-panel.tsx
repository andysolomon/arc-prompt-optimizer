"use client";

import { OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { failureAdvice, failureTitle, type RunFailure } from "@/lib/client/failure";
import { modelLabel } from "@/lib/models";

/**
 * Stays on the page until dismissed or a new run starts, so a user who switched apps during a run on a phone
 * comes back to the reason rather than to an empty form. The run id lets a report be matched to the server log.
 */
export function FailurePanel({ failure, canRetry, onRetry, onDismiss }: { failure: RunFailure; canRetry: boolean; onRetry: () => void; onDismiss: () => void }) {
  const when = new Date(failure.at);
  return (
    <section
      role="alert"
      aria-label="Optimization failed"
      data-testid="run-failure"
      className="flex flex-col gap-3 rounded-[10px] border border-destructive/40 bg-destructive/5 p-5 text-[13px] leading-relaxed"
    >
      <div className="flex items-start gap-2.5">
        <OctagonX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="m-0 text-sm font-semibold">{failureTitle(failure)}</h2>
          <p className="m-0 [overflow-wrap:anywhere]" data-testid="run-failure-message">
            {failure.message}
          </p>
          <p className="m-0 text-muted-foreground">{failureAdvice(failure)}</p>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Model</dt>
        <dd className="m-0">{modelLabel(failure.model)}</dd>
        {failure.runId !== undefined ? (
          <>
            <dt>Run</dt>
            <dd className="m-0">
              <code className="font-mono [overflow-wrap:anywhere]">{failure.runId}</code>
            </dd>
          </>
        ) : null}
        {failure.lastStep !== undefined ? (
          <>
            <dt>Reached</dt>
            <dd className="m-0">
              <code className="font-mono [overflow-wrap:anywhere]">{failure.lastStep}</code>
            </dd>
          </>
        ) : null}
        <dt>When</dt>
        <dd className="m-0">
          <time dateTime={when.toISOString()}>{when.toLocaleString()}</time>
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-8 px-3 text-[13px]" disabled={!canRetry} onClick={onRetry}>
          Try again
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-[13px]" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
