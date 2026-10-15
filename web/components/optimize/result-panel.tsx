"use client";

import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { JevSparkline } from "@/components/optimize/sparkline";
import { SavePromptButton } from "@/components/library/prompt-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentStrip } from "@/components/optimize/attachment-strip";
import type { LocalAttachment } from "@/lib/client/images";
import { lineDiffSummary } from "@/lib/diff";
import { candidateLabel, checkLabel, formatCharacterCount, formatCost, formatLatency, formatScore, formatTokens } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import type { JevAnswer, OptimizeResult, PlanReport, RankedCandidate, RevisionReport } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CAVEAT_JUDGED =
  "The Jev score is a Score question over four levels, normalized and averaged with the deterministic score. Confidence reflects how spread the probability is across levels, not whether the answer is correct.";
export const CAVEAT_DETERMINISTIC =
  "Scores come from deterministic checks only. Ties are broken by total tokens, then latency, which say nothing about prompt quality, so a tied rewrite or revision is shown first. Enable the Jev judge for a semantic comparison.";
export const CAVEAT_PLANNED =
  "The checks were planned by the same model that wrote the rewrite, so they favor what it set out to do. Every candidate's output is scored against the same checks; the quality score is the fraction passed.";
export const CAVEAT_DEFAULT =
  "No task checks were planned for this run, so the only check is that each output is non-empty and every candidate passes it.";

const TASK_TYPE_LABELS: Readonly<Record<string, string>> = {
  data_extraction: "data extraction",
  classification: "classification",
  summarization: "summarization",
  code_generation: "code generation",
  creative_writing: "creative writing",
  multi_step_reasoning: "multi-step reasoning",
  question_answering: "question answering",
  content_moderation: "content moderation",
  translation_adaptation: "translation or adaptation",
  analysis_review: "analysis or review",
  other: "general",
};

export function describeCriteria(plan: Extract<PlanReport, { status: "planned" }>): string[] {
  const items: string[] = [];
  if (plan.criteria.expectedFormat !== undefined) items.push(`${plan.criteria.expectedFormat.replace(/_/gu, " ")} format`);
  if (plan.criteria.maxWords !== undefined) items.push(`at most ${plan.criteria.maxWords} words`);
  if (plan.criteria.minWords !== undefined) items.push(`at least ${plan.criteria.minWords} words`);
  for (const keyword of plan.criteria.requiredKeywords) items.push(`mentions "${keyword}"`);
  for (const phrase of plan.criteria.forbiddenPhrases) items.push(`never says "${phrase}"`);
  return items;
}

export function loopSummary(result: OptimizeResult): string {
  const revised = result.revisions.filter((revision) => revision.status === "revised").length;
  const rounds = revised === 0 ? "" : `${revised} revision ${revised === 1 ? "round" : "rounds"} ran. `;
  switch (result.loop.stoppedBecause) {
    case "all_checks_passed":
      return `${rounds}${revised === 0 ? "The rewrite passed every check on its first run, so no revision was needed." : "The last revision passed every check."}`;
    case "max_rounds":
      return `${rounds}The revision limit was reached with checks still failing; the best-scoring candidate is shown.`;
    case "time_budget":
      return `${rounds}Another round did not fit in the run's time budget, so revising stopped.`;
    case "revision_failed":
      return `${rounds}The model's revision reply could not be used, so revising stopped.`;
    case "no_criteria":
      return "No objective checks were planned, so there was nothing to revise against.";
    case "rewrite_failed":
      return "The rewrite failed, so there was nothing to revise.";
    case "candidate_failed":
      return `${rounds}${revised === 0 ? "The rewrite's own run failed, so there was no output to revise against." : "The last revision's run failed, so revising stopped."}`;
    case "not_requested":
      return "";
  }
}

/** One line per candidate that did not finish, for the result card. */
export function failureSummary(result: OptimizeResult): string | undefined {
  if (result.failures.length === 0) return undefined;
  const total = result.candidates.length;
  const names = result.failures.map((failure) => `${failure.label}: ${failure.error.message}`).join(" ");
  return `${result.failures.length} of ${total} candidates did not finish and ${result.failures.length === 1 ? "is" : "are"} left out of the ranking. ${names}`;
}

export interface RowView {
  readonly ranked: RankedCandidate;
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly edited: boolean;
  readonly added: number;
  readonly removed: number;
  /** "3/4 checks" over the deterministic checks of the candidate's case. */
  readonly passedText: string;
  readonly allPassed: boolean;
  /** Labels of the checks the output failed. */
  readonly failed: readonly string[];
  readonly jev: JevAnswer | undefined;
  /** The rewrite or revision report that explains this candidate, when it is one. */
  readonly reasons: { readonly title: string; readonly analysisTitle: string; readonly analysis: readonly string[]; readonly changes: readonly string[] } | undefined;
}

function reasonsFor(result: OptimizeResult, candidateId: string): RowView["reasons"] {
  if (result.rewrite.status === "rewritten" && result.rewrite.candidateId === candidateId) {
    return { title: "Why it was rewritten", analysisTitle: "Weaknesses in the original", analysis: result.rewrite.analysis, changes: result.rewrite.changes };
  }
  const revision = result.revisions.find((entry): entry is Extract<RevisionReport, { status: "revised" }> => entry.status === "revised" && entry.candidateId === candidateId);
  if (revision !== undefined) {
    return {
      title: `Why it was revised (round ${revision.round})`,
      analysisTitle: `Why the previous version failed ${revision.targeted.length === 1 ? "its check" : `${revision.targeted.length} checks`}`,
      analysis: revision.analysis,
      changes: revision.changes,
    };
  }
  if (result.refine.status === "refined") {
    for (const round of result.refine.rounds) {
      const attempt = round.attempts.find((entry) => entry.status === "evaluated" && entry.candidateId === candidateId);
      if (attempt !== undefined && attempt.status === "evaluated") {
        return { title: `Why it was refined (round ${round.round})`, analysisTitle: "What the previous output got wrong", analysis: attempt.analysis, changes: attempt.changes };
      }
    }
  }
  return undefined;
}

export function buildRows(result: OptimizeResult, edited: Readonly<Record<string, string>>): RowView[] {
  const original = result.candidates.find((c) => c.id === result.baselineCandidateId)?.prompt.text ?? "";
  return result.ranking.map((ranked) => {
    const candidate = result.candidates.find((c) => c.id === ranked.candidateId);
    const evaluation = result.evaluations.find((e) => e.candidateId === ranked.candidateId);
    const text = edited[ranked.candidateId] ?? candidate?.prompt.text ?? "";
    const diff = lineDiffSummary(original, text);
    const checks = evaluation?.cases.flatMap((entry) => entry.deterministic.checks) ?? [];
    const passed = checks.filter((check) => check.passed).length;
    return {
      ranked,
      id: ranked.candidateId,
      label: candidate ? candidateLabel(candidate.metadata?.label, candidate.prompt.pattern) : ranked.candidateId,
      text,
      edited: edited[ranked.candidateId] !== undefined,
      added: diff.added,
      removed: diff.removed,
      passedText: `${passed}/${checks.length} ${checks.length === 1 ? "check" : "checks"}`,
      allPassed: checks.length > 0 && passed === checks.length,
      failed: checks.filter((check) => !check.passed).map(checkLabel),
      jev: result.judge.status === "judged" ? result.judge.answers[ranked.candidateId] : undefined,
      reasons: reasonsFor(result, ranked.candidateId),
    };
  });
}

export function ResultPanel({
  result,
  attachments = [],
  selectedId,
  edited,
  onSelect,
  onSaveEdit,
}: {
  result: OptimizeResult;
  /** Images that were sent with every completion of this run. */
  attachments?: readonly LocalAttachment[];
  selectedId: string | null;
  edited: Readonly<Record<string, string>>;
  onSelect: (id: string) => void;
  onSaveEdit: (id: string, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showReasons, setShowReasons] = useState(false);
  const rows = buildRows(result, edited);
  const best = rows.find((row) => row.id === selectedId) ?? rows[0];
  if (best === undefined) return null;
  const judgeUsed = result.judge.status === "judged";
  const reasons = best.reasons;
  const hasReasons = reasons !== undefined && (reasons.analysis.length > 0 || reasons.changes.length > 0);
  const planned = result.plan.status === "planned" ? result.plan : undefined;
  const criteria = planned === undefined ? [] : describeCriteria(planned);
  const summary = loopSummary(result);
  const failed = failureSummary(result);
  const refineReport = result.refine.status === "refined" ? result.refine : undefined;
  const improvedRounds = refineReport?.rounds.filter((round) => round.improved).length ?? 0;

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

      {attachments.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-muted-foreground">
            {attachments.length === 1 ? "This image was" : `These ${attachments.length} images were`} sent with every completion.
          </span>
          <AttachmentStrip attachments={attachments} />
        </div>
      ) : null}

      {failed !== undefined ? (
        <div role="alert" data-testid="candidate-failures" className="rounded-[10px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px] leading-relaxed">
          <p className="m-0 font-medium">Some candidates did not finish.</p>
          <p className="m-0 mt-1 text-muted-foreground">{failed} The ranking below covers the candidates that did. Run again, or pick a faster model, to compare all of them.</p>
        </div>
      ) : null}

      {result.rewrite.status === "failed" ? (
        <div role="alert" className="rounded-[10px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px] leading-relaxed">
          <p className="m-0 font-medium">The model did not produce a usable rewrite after {result.rewrite.attempts} {result.rewrite.attempts === 1 ? "attempt" : "attempts"}.</p>
          <p className="m-0 mt-1 text-muted-foreground">
            Reason: {result.rewrite.reason}. The candidates below are your original prompt and {result.candidates.length - 1} pattern variants of it,
            ranked by deterministic checks only. Try again, or pick a different model.
          </p>
        </div>
      ) : null}

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
              <SavePromptButton prompt={best.text} />
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

        {hasReasons && reasons ? (
          <Collapsible open={showReasons} onOpenChange={setShowReasons} className="border-t border-border">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-b-[10px] px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span>
                  {reasons.title} ({reasons.changes.length} {reasons.changes.length === 1 ? "change" : "changes"})
                </span>
                <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", showReasons && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 px-4 pb-4 text-[13px] leading-relaxed">
                {reasons.analysis.length > 0 ? (
                  <div>
                    <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">{reasons.analysisTitle}</h3>
                    <ul className="m-0 list-disc space-y-0.5 pl-5">
                      {reasons.analysis.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {reasons.changes.length > 0 ? (
                  <div>
                    <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">Changes</h3>
                    <ol className="m-0 list-decimal space-y-0.5 pl-5">
                      {reasons.changes.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>

      <section aria-label="Checks" data-testid="checks" className="flex flex-col gap-2 rounded-[10px] border border-border bg-card px-4 py-3.5 text-[13px] leading-relaxed">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-sm font-medium">How candidates were scored</h3>
          {planned ? (
            <span className="text-xs text-muted-foreground">
              {TASK_TYPE_LABELS[planned.taskType] ?? planned.taskType} task
              {planned.temperature === undefined ? "" : ` · suggested temperature ${planned.temperature}`}
            </span>
          ) : null}
        </div>
        {planned ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {criteria.map((item) => (
              <li key={item} className="rounded-full border border-border px-2 py-0.5 text-xs">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-muted-foreground">
            {CAVEAT_DEFAULT} {result.plan.status === "default" ? result.plan.reason : ""}
          </p>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          {best.allPassed ? `The selected candidate passed ${best.passedText}.` : `The selected candidate passed ${best.passedText}; failed: ${best.failed.join(", ")}.`}
          {summary ? ` ${summary}` : ""}
        </p>
      </section>

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
                      <span className={row.allPassed ? "text-success" : "text-destructive"} title={row.failed.length === 0 ? undefined : `Failed: ${row.failed.join(", ")}`}>
                        {row.passedText}
                      </span>
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
            <p className="m-0 px-4 py-3 text-xs leading-relaxed text-muted-foreground text-pretty">
              {planned ? CAVEAT_PLANNED : CAVEAT_DEFAULT} {judgeUsed ? CAVEAT_JUDGED : CAVEAT_DETERMINISTIC}
            </p>
            {result.revisions.some((revision) => revision.status === "failed") ? (
              <p role="status" className="m-0 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                {result.revisions
                  .filter((revision): revision is Extract<RevisionReport, { status: "failed" }> => revision.status === "failed")
                  .map((revision) => `Revision round ${revision.round} failed after ${revision.attempts} ${revision.attempts === 1 ? "attempt" : "attempts"}: ${revision.reason}.`)
                  .join(" ")}
              </p>
            ) : null}
            {result.judge.status === "failed" ? (
              <p role="status" className="m-0 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Jev judging failed, so this ranking uses deterministic checks only. Reason: {result.judge.reason}
              </p>
            ) : null}
            {refineReport ? (
              <p role="status" className="m-0 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Refined over {refineReport.rounds.length} {refineReport.rounds.length === 1 ? "round" : "rounds"}
                {improvedRounds > 0 ? `; ${improvedRounds} ${improvedRounds === 1 ? "round" : "rounds"} beat the previous best` : "; no revision beat the first-pass winner"}
                {refineReport.stopReason === "perfect_score" ? ". Stopped early at a perfect score." : refineReport.stopReason === "budget_exhausted" ? ". Stopped early at the completion budget." : "."}
              </p>
            ) : null}
            {result.refine.status === "failed" ? (
              <p role="status" className="m-0 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Refining failed, so this is the first-pass ranking. Reason: {result.refine.reason}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
