import "server-only";
import type { JudgeRequest, SemanticJudgeAdapter } from "@/lib/arc-core/core/index.js";
import { JEV_INSTRUCTIONS, JEV_MAX_LEVEL, judgeWithJev, type JevClientOptions } from "@/lib/jev";
import type { JevAnswer } from "@/lib/types";

/** Rubric carried by the refine suite case so the core calls the judge for every refined candidate. */
export const JEV_RUBRIC = JEV_INSTRUCTIONS;

/**
 * Core `SemanticJudgeAdapter` backed by TypeSafe's Jev, one Score question per call. The core reads the
 * `{ score, rationale }` it returns; the raw answers are kept by candidate id so the run can report them
 * alongside the batch answers for the first-pass candidates.
 */
export class JevJudgeAdapter implements SemanticJudgeAdapter {
  readonly #options: JevClientOptions;
  readonly answers: Record<string, JevAnswer> = {};
  model: string | undefined;

  constructor(options: JevClientOptions) {
    this.#options = options;
  }

  async judge(request: JudgeRequest): Promise<unknown> {
    const report = await judgeWithJev(
      [{ candidateId: request.candidateId, prompt: request.candidatePrompt ?? "", output: request.candidateOutput }],
      this.#options,
    );
    if (report.status !== "judged") throw new Error(report.status === "failed" ? report.reason : "TypeSafe judge was not run.");
    const answer = report.answers[request.candidateId];
    if (answer === undefined) throw new Error("TypeSafe returned no answer for the candidate.");
    this.answers[request.candidateId] = answer;
    this.model = report.model;
    return {
      score: answer.normalized,
      rationale: `TypeSafe ${report.model} Score ${answer.score.toFixed(2)} of ${JEV_MAX_LEVEL}, confidence ${answer.confidence.toFixed(2)}.`,
    };
  }
}

/** Test fixture: scores every refined candidate one level above the mock first-pass answers so the loop improves. */
export class MockJevJudgeAdapter implements SemanticJudgeAdapter {
  readonly answers: Record<string, JevAnswer> = {};
  readonly model = "jev-mock";
  #calls = 0;

  async judge(request: JudgeRequest): Promise<unknown> {
    this.#calls += 1;
    const legend = { "0": "Off-task or empty", "1": "Addresses the task but incomplete or vague", "2": "Complete and accurate, some loose ends", "3": "Complete, accurate, and clearly organized" };
    const score = this.#calls === 1 ? 3 : 2;
    const answer: JevAnswer = { score, confidence: 0.9, probabilities: { [String(score)]: 1 }, legend, normalized: score / JEV_MAX_LEVEL };
    this.answers[request.candidateId] = answer;
    return { score: answer.normalized, rationale: `Mock Score ${score} of ${JEV_MAX_LEVEL}.` };
  }
}
