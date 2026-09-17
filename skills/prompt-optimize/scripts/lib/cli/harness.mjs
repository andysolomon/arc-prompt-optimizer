import { MAX_COMPLETION_OUTPUT_CHARACTERS } from "../adapters/completion.mjs";
import { CoreValidationError } from "../core/errors.mjs";
import { MAX_EVALUATION_CANDIDATES, MAX_EVALUATION_COMPLETIONS, MAX_EVALUATION_PROMPT_CHARACTERS, aggregateCases, evaluateOutput, measureCompletion, } from "../core/evaluation.mjs";
import { buildPreviewCandidates } from "../core/preview.mjs";
import { DEFAULT_RANKING_OBJECTIVE, rankCandidates } from "../core/ranking.mjs";
import { expectDenseArray, expectRecord, expectString, hasOwnField, readOwnField, rejectUnknownKeys } from "../core/validation.mjs";
/**
 * Model-free, harness-neutral tools. This module must not import Pi or any completion adapter: the calling harness
 * produces outputs with its own model, and these helpers only render candidates and score outputs deterministically.
 */
const CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const MEASUREMENT_KEYS = ["latencyMs", "inputTokens", "outputTokens", "costUsd"];
function candidateLabel(candidate) {
    const label = candidate.metadata?.["label"];
    return typeof label === "string" ? label : candidate.prompt.pattern;
}
export function harnessCandidates(prompt) {
    return Object.freeze(buildPreviewCandidates(prompt).map((candidate) => Object.freeze({
        id: candidate.id,
        pattern: candidate.prompt.pattern,
        label: candidateLabel(candidate),
        prompt: candidate.prompt.text,
    })));
}
function validateMeasurement(value, label) {
    const record = expectRecord(value, "INVALID_EVALUATION", label);
    rejectUnknownKeys(record, MEASUREMENT_KEYS, "INVALID_EVALUATION", label);
    const checked = {};
    for (const key of MEASUREMENT_KEYS) {
        const field = readOwnField(record, key);
        if (field === undefined)
            continue;
        const integer = key !== "costUsd";
        if (typeof field !== "number" || !Number.isFinite(field) || field < 0 || (integer && !Number.isSafeInteger(field))) {
            throw new CoreValidationError("INVALID_EVALUATION", `${label} '${key}' must be a non-negative ${integer ? "safe integer" : "finite number"}.`);
        }
        checked[key] = field;
    }
    return Object.freeze(checked);
}
/** Strictly validates `{"candidates":[{"id","prompt"?,"outputs":{caseId:text},"measurements"?:{caseId:{...}}}]}`. */
export function validateHarnessOutputs(value, suite) {
    const root = expectRecord(value, "INVALID_EVALUATION", "Outputs JSON");
    rejectUnknownKeys(root, ["candidates"], "INVALID_EVALUATION", "Outputs JSON");
    const entries = expectDenseArray(readOwnField(root, "candidates"), "INVALID_EVALUATION", "Outputs JSON candidates");
    if (entries.length === 0)
        throw new CoreValidationError("INVALID_EVALUATION", "Outputs JSON must include at least one candidate.");
    if (entries.length > MAX_EVALUATION_CANDIDATES) {
        throw new CoreValidationError("BUDGET_EXCEEDED", `Outputs JSON has ${entries.length} candidates; limit is ${MAX_EVALUATION_CANDIDATES}.`);
    }
    const scored = entries.length * suite.cases.length;
    if (scored > MAX_EVALUATION_COMPLETIONS) {
        throw new CoreValidationError("BUDGET_EXCEEDED", `Scoring ${entries.length} candidates against ${suite.cases.length} cases needs ${scored} outputs; limit is ${MAX_EVALUATION_COMPLETIONS}.`);
    }
    const caseIds = suite.cases.map((entry) => entry.id);
    const ids = new Set();
    return Object.freeze(entries.map((entry, index) => {
        const record = expectRecord(entry, "INVALID_EVALUATION", `Outputs candidate at index ${index}`);
        rejectUnknownKeys(record, ["id", "prompt", "outputs", "measurements"], "INVALID_EVALUATION", `Outputs candidate at index ${index}`);
        const id = expectString(readOwnField(record, "id"), "INVALID_EVALUATION", `Outputs candidate at index ${index} id`);
        if (!CANDIDATE_ID.test(id) || id.length > 128) {
            throw new CoreValidationError("INVALID_EVALUATION", `Candidate id '${id}' must match [A-Za-z0-9][A-Za-z0-9_.-]* and be at most 128 characters.`);
        }
        if (ids.has(id))
            throw new CoreValidationError("INVALID_EVALUATION", `Candidate id '${id}' is duplicated.`);
        ids.add(id);
        if (hasOwnField(record, "prompt")) {
            const prompt = expectString(readOwnField(record, "prompt"), "INVALID_EVALUATION", `Candidate '${id}' prompt`);
            if (prompt.length > MAX_EVALUATION_PROMPT_CHARACTERS) {
                throw new CoreValidationError("INPUT_TOO_LARGE", `Candidate '${id}' prompt is ${prompt.length} characters; limit is ${MAX_EVALUATION_PROMPT_CHARACTERS}.`);
            }
        }
        const outputsRecord = expectRecord(readOwnField(record, "outputs"), "INVALID_EVALUATION", `Candidate '${id}' outputs`);
        rejectUnknownKeys(outputsRecord, caseIds, "INVALID_EVALUATION", `Candidate '${id}' outputs`);
        const outputs = {};
        for (const caseId of caseIds) {
            if (!hasOwnField(outputsRecord, caseId)) {
                throw new CoreValidationError("INVALID_EVALUATION", `Candidate '${id}' is missing an output for case '${caseId}' in suite '${suite.id}'.`);
            }
            const text = expectString(readOwnField(outputsRecord, caseId), "INVALID_EVALUATION", `Candidate '${id}' output for case '${caseId}'`);
            if (text.length > MAX_COMPLETION_OUTPUT_CHARACTERS) {
                throw new CoreValidationError("OUTPUT_TOO_LARGE", `Candidate '${id}' output for case '${caseId}' is ${text.length} characters; limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}.`);
            }
            outputs[caseId] = text;
        }
        const measurements = {};
        if (hasOwnField(record, "measurements")) {
            const measurementRecord = expectRecord(readOwnField(record, "measurements"), "INVALID_EVALUATION", `Candidate '${id}' measurements`);
            rejectUnknownKeys(measurementRecord, caseIds, "INVALID_EVALUATION", `Candidate '${id}' measurements`);
            for (const caseId of caseIds) {
                if (!hasOwnField(measurementRecord, caseId))
                    continue;
                measurements[caseId] = validateMeasurement(readOwnField(measurementRecord, caseId), `Candidate '${id}' measurements for case '${caseId}'`);
            }
        }
        return Object.freeze({ id, outputs: Object.freeze(outputs), measurements: Object.freeze(measurements) });
    }));
}
function completionLike(measurement) {
    if (measurement === undefined)
        return {};
    const hasUsage = measurement.inputTokens !== undefined || measurement.outputTokens !== undefined;
    return {
        ...(measurement.latencyMs === undefined ? {} : { latencyMs: measurement.latencyMs }),
        ...(measurement.costUsd === undefined ? {} : { costUsd: measurement.costUsd }),
        ...(hasUsage
            ? {
                usage: {
                    ...(measurement.inputTokens === undefined ? {} : { inputTokens: measurement.inputTokens }),
                    ...(measurement.outputTokens === undefined ? {} : { outputTokens: measurement.outputTokens }),
                },
            }
            : {}),
    };
}
/** Deterministic checks only: no completions and no semantic judge. Missing measurements stay unknown. */
export function scoreHarnessOutputs(suite, value) {
    const candidates = validateHarnessOutputs(value, suite);
    const evaluations = candidates.map((candidate) => {
        const cases = suite.cases.map((evaluationCase) => {
            const text = candidate.outputs[evaluationCase.id];
            return Object.freeze({
                caseId: evaluationCase.id,
                candidateId: candidate.id,
                completionFixtureId: evaluationCase.completionFixtureId,
                model: null,
                finishReason: null,
                outputCharacters: text.length,
                deterministic: evaluateOutput(text, evaluationCase.criteria),
                judge: Object.freeze({ status: "not_requested" }),
                measurements: measureCompletion(completionLike(candidate.measurements[evaluationCase.id])),
            });
        });
        const frozenCases = Object.freeze(cases);
        return Object.freeze({ candidateId: candidate.id, cases: frozenCases, aggregate: aggregateCases(frozenCases) });
    });
    const frozenEvaluations = Object.freeze(evaluations);
    return Object.freeze({
        suiteId: suite.id,
        evaluations: frozenEvaluations,
        ranking: rankCandidates(frozenEvaluations, DEFAULT_RANKING_OBJECTIVE),
        objective: DEFAULT_RANKING_OBJECTIVE,
    });
}
