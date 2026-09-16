import { aggregateCases, evaluateCase, preflightEvaluationRequests } from "../core/evaluation.js";
import { CompletionCancelledError } from "../adapters/completion.js";
import type {
  CandidateEvaluation,
  CaseEvaluation,
  CompletionAdapter,
  EvaluateOptions,
  EvaluationSuite,
  PromptCandidate,
  SuiteEvaluation,
} from "../core/index.js";

type QueueTask<T> = () => Promise<T>;

async function runBounded<T>(
  tasks: readonly QueueTask<T>[],
  concurrency: number,
  abortController: AbortController,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  let firstError: unknown;
  let hasFirstError = false;
  async function worker(): Promise<void> {
    for (;;) {
      if (hasFirstError || abortController.signal.aborted) return;
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task === undefined) return;
      try {
        results[index] = await task();
      } catch (error) {
        if (!hasFirstError) {
          firstError = error;
          hasFirstError = true;
          abortController.abort();
        }
        return;
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  if (hasFirstError) throw firstError;
  return results;
}

export async function evaluateCandidatesBounded(
  adapter: CompletionAdapter,
  candidates: readonly PromptCandidate[],
  suite: EvaluationSuite,
  options: EvaluateOptions,
  concurrency: number,
): Promise<SuiteEvaluation> {
  const checkedOptions = preflightEvaluationRequests(adapter, candidates, suite, options);
  const callerSignal = checkedOptions.signal;
  const abortController = new AbortController();
  const abortFromCaller = (): void => abortController.abort();
  if (callerSignal?.aborted) throw new CompletionCancelledError();
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const tasks = candidates.flatMap((candidate) =>
    suite.cases.map((evaluationCase) => async () =>
      await evaluateCase(adapter, candidate, evaluationCase, {
        ...checkedOptions,
        signal: abortController.signal,
      }),
    ),
  );
  let caseResults: CaseEvaluation[];
  try {
    caseResults = await runBounded(tasks, concurrency, abortController);
  } finally {
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
  const evaluations: CandidateEvaluation[] = [];
  let offset = 0;
  for (const candidate of candidates) {
    const cases = Object.freeze(caseResults.slice(offset, offset + suite.cases.length));
    offset += suite.cases.length;
    evaluations.push(Object.freeze({ candidateId: candidate.id, cases, aggregate: aggregateCases(cases) }));
  }
  return Object.freeze({
    suiteId: suite.id,
    candidates: Object.freeze(evaluations),
    completionsUsed: caseResults.length,
  });
}
