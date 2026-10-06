"use client";

import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { JevSparkline } from "@/components/optimize/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { lineDiffSummary } from "@/lib/diff";
import { candidateLabel, formatCharacterCount, formatCost, formatLatency, formatScore, formatTokens } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import type { JevAnswer, OptimizeResult, RankedCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CAVEAT_JUDGED =
  "Deterministic checks use the preview suite, which only verifies that each output is non-empty, so every candidate passes 1/1. The Jev score is a Score question over four levels, normalized and averaged with the deterministic score. Confidence reflects how spread the probability is across levels, not whether the answer is correct. Supply an evaluation suite for a meaningful comparison.";
export const CAVEAT_DETERMINISTIC =
  "Scores come from deterministic checks only. Without an evaluation suite, the preview suite only checks that outputs are non-empty, so ties are expected and are broken by total tokens, then latency. Enable the Jev judge or supply a suite for a meaningful comparison.";

export interface RowView {
  readonly ranked: RankedCandidate;
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly edited: boolean;
  readonly added: number;
  readonly removed: number;
  readonly passedText: string;
  readonly allPassed: boolean;
  readonly jev: JevAnswer | undefined;
}

export function buildRows(result: OptimizeResult, edited: Readonly<Record<string, string>>): RowView[] {
  const original = result.candidates.find((c) => c.id === result.baselineCandidateId)?.prompt.text ?? "";
  return result.ranking.map((ranked) => {
    const candidate = result.candidates.find((c) => c.id === ranked.candidateId);
    const evaluation = result.evaluations.find((e) => e.candidateId === ranked.candidateId);
    const text = edited[ranked.candidateId] ?? candidate?.prompt.text ?? "";
    const diff = lineDiffSummary(original, text);
    const caseCount = evaluation?.aggregate.caseCount ?? 0;
    const passed = evaluation?.aggregate.passedCaseCount ?? 0;
    return {
      ranked,
      id: ranked.candidateId,
      label: candidate ? candidateLabel(candidate.metadata?.label, candidate.prompt.pattern) : ranked.candidateId,
      text,
      edited: edited[ranked.candidateId] !== undefined,
      added: diff.added,
      removed: diff.removed,
      passedText: `passed ${passed}/${caseCount}`,
      allPassed: caseCount > 0 && passed === caseCount,
      jev: result.judge.status === "judged" ? result.judge.answers[ranked.candidateId] : undefined,
    };
  });
}

export function ResultPanel({
  result,
  selectedId,
  edited,
  onSelect,
  onSaveEdit,
}: {
  result: OptimizeResult;
  selectedId: string | null;
  edited: Readonly<Record<string, string>>;
  onSelect: (id: string) => void;
  onSaveEdit: (id: string, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const rows = buildRows(result, edited);
  const best = rows.find((row) => row.id === selectedId) ?? rows[0];
  if (best === undefined) return null;
  const judgeUsed = result.judge.status === "judged";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(best.text);
      toast("Copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  };

  return (
    <section aria-label="Result" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">{best.ranked.rank === 1 ? "Best candidate" : "Selected candidate"}</h2>
        <span className="text-[13px] text-muted-foreground">
          {result.completionsUsed} completions · {modelLabel(result.model)}
        </span>
      </div>

      <div className="flex flex-col rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3.5">
          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs font-medium hover:bg-secondary">
            {best.label}
          </Badge>
          <code className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{best.id}</code>
          {best.edited ? <span className="text-xs text-muted-foreground">edited</span> : null}
          <div className="ml-auto flex flex-wrap gap-4 text-[13px] text-muted-foreground tabular-nums">
            <span>
              Quality <strong className="font-medium text-foreground">{formatScore(best.ranked.quality.combined)}</strong>
            </span>
            {judgeUsed ? (
              <span>
                Jev <strong className="font-medium text-foreground">{best.jev ? best.jev.score.toFixed(2) : "n/a"}</strong> · conf{" "}
                <strong className="font-medium text-foreground">{best.jev ? best.jev.confidence.toFixed(2) : "n/a"}</strong>
              </span>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div>
            <label htmlFor="candidate-editor" className="sr-only">
              Edit candidate prompt
            </label>
            <Textarea
              id="candidate-editor"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              autoFocus
              className="min-h-[260px] resize-y rounded-none border-0 bg-code p-4 font-mono text-[13px] leading-[1.65] focus-visible:ring-inset md:text-[13px]"
            />
          </div>
        ) : (
          <pre
            data-testid="best-prompt"
            className="m-0 max-h-[420px] overflow-auto bg-code p-4 font-mono text-[13px] leading-[1.65] whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {best.text}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 px-3 text-[13px]"
                onClick={() => {
                  onSaveEdit(best.id, draft);
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-[13px]" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground">{formatCharacterCount(draft.length)}</span>
            </>
          ) : (
            <>
              <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-[13px]" onClick={copy}>
                <Copy className="size-3.5" aria-hidden="true" />
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-[13px]"
                onClick={() => {
                  setDraft(best.text);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            +{best.added} −{best.removed} lines vs. original
          </span>
        </div>
      </div>

      <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-[10px] border border-border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-[10px] px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{expanded ? "Hide candidates" : `See all candidates (${rows.length})`}</span>
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col border-t border-border">
            {rows.map((row) => {
              const isSelected = row.id === best.id;
              return (
                <div
                  key={row.id}
                  data-testid="candidate-row"
                  className={cn(
                    "grid grid-cols-[28px_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-b border-border px-4 py-3.5 sm:grid-cols-[28px_minmax(0,1fr)_auto]",
                    isSelected && "bg-muted",
                  )}
                >
                  <div className="pt-0.5 text-[13px] text-muted-foreground tabular-nums">{row.ranked.rank}</div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{row.label}</span>
                      <code className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{row.id}</code>
                      {isSelected ? (
                        <span className="rounded-full bg-primary px-1.5 py-px text-[11px] text-primary-foreground">selected</span>
                      ) : null}
                      {row.edited ? <span className="text-[11px] text-muted-foreground">edited</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground tabular-nums">
                      <span>
                        quality <span className="text-foreground">{formatScore(row.ranked.quality.combined)}</span>
                      </span>
                      <span className={row.allPassed ? "text-success" : "text-destructive"}>{row.passedText}</span>
                      <span>
                        <span className="text-diff-add">+{row.added}</span> <span className="text-diff-del">−{row.removed}</span> lines
                      </span>
                      <span>latency {formatLatency(row.ranked.operational.latencyMs)}</span>
                      <span>tokens {formatTokens(row.ranked.operational.totalTokens)}</span>
                      <span>cost {formatCost(row.ranked.operational.costUsd)}</span>
                    </div>
                    {judgeUsed ? (
                      <div className="flex items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
                        <span className="whitespace-nowrap">
                          Jev {row.jev ? row.jev.score.toFixed(2) : "n/a"} · conf {row.jev ? row.jev.confidence.toFixed(2) : "n/a"}
                        </span>
                        {row.jev ? <JevSparkline answer={row.jev} /> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="col-start-2 flex items-start sm:col-start-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSelected}
                      aria-label={`Use ${row.label}`}
                      className="h-[30px] px-2.5 text-xs"
                      onClick={() => {
                        setEditing(false);
                        onSelect(row.id);
                      }}
                    >
                      Use this
                    </Button>
                  </div>
                </div>
              );
            })}
            <p className="m-0 px-4 py-3 text-xs leading-relaxed text-muted-foreground text-pretty">{judgeUsed ? CAVEAT_JUDGED : CAVEAT_DETERMINISTIC}</p>
            {result.judge.status === "failed" ? (
              <p role="status" className="m-0 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Jev judging failed, so this ranking uses deterministic checks only. Reason: {result.judge.reason}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
