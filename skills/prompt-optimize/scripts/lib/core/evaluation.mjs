import { CoreValidationError } from "./errors.mjs";
import { completeWithTimeout, MAX_COMPLETION_MODEL_CHARACTERS, MAX_COMPLETION_OUTPUT_CHARACTERS, MAX_COMPLETION_TIMEOUT_MS, normalizeCompletionRequest, throwIfCompletionAborted, validateCompletionResult, } from "../adapters/completion.mjs";
import { MAX_CRITERION_TERM_CHARACTERS, MAX_FIXTURE_CHECK_CHARACTERS, countWords, matchesFormat, nonEmptyLines, validateDeterministicCriteria, } from "./fixture-checks.mjs";
import { buildJudgeRequest, runSemanticJudge } from "./judge.mjs";
import { encodedTemplateValueLength, escapeTemplateValue } from "./template.mjs";
import { expectDenseArray, expectRecord, expectString, hasOwnField, ownPropertyNames, readOwnField, rejectUnknownKeys, } from "./validation.mjs";
export const MAX_CRITERION_WEIGHT = 1_000;
export const MAX_CUSTOM_CRITERIA = 64;
export const MAX_JSON_SHAPE_KEYS = 64;
export const MAX_EVALUATION_CASES = 64;
export const MAX_EVALUATION_CANDIDATES = 32;
export const MAX_EVALUATION_COMPLETIONS = 256;
export const MAX_CASE_INPUT_CHARACTERS = 16_384;
export const MAX_EVALUATION_PROMPT_CHARACTERS = 48_000;
const BUILTIN_CRITERION_NAMES = Object.freeze([
    "format",
    "max_words",
    "min_words",
    "required_keyword",
    "forbidden_phrase",
    "exact_match",
    "max_characters",
    "min_characters",
    "json_shape",
    "list_shape",
]);
const CUSTOM_KINDS = Object.freeze([
    "includes",
    "excludes",
    "equals",
    "starts_with",
    "ends_with",
]);
const CRITERION_ID = /^[A-Za-z][A-Za-z0-9_.-]*$/u;
function invalid(message) {
    throw new CoreValidationError("INVALID_CRITERIA", message);
}
function validateWeight(label, value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_CRITERION_WEIGHT) {
        invalid(`${label} must be a finite number between 0 and ${MAX_CRITERION_WEIGHT}.`);
    }
    return value;
}
function validateOptionalNonNegativeInteger(label, value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        invalid(`${label} must be a non-negative safe integer.`);
    }
    return value;
}
function validateJsonShape(value) {
    if (value === undefined)
        return undefined;
    const shape = expectRecord(value, "INVALID_CRITERIA", "Criterion 'jsonShape'");
    rejectUnknownKeys(shape, ["rootType", "requiredKeys"], "INVALID_CRITERIA", "Criterion 'jsonShape'");
    const rootType = readOwnField(shape, "rootType");
    if (rootType !== undefined && rootType !== "object" && rootType !== "array") {
        invalid("Criterion 'jsonShape.rootType' must be 'object' or 'array'.");
    }
    const keysValue = readOwnField(shape, "requiredKeys");
    let requiredKeys;
    if (keysValue !== undefined) {
        const keys = expectDenseArray(keysValue, "INVALID_CRITERIA", "Criterion 'jsonShape.requiredKeys'");
        if (keys.length > MAX_JSON_SHAPE_KEYS) {
            throw new CoreValidationError("INPUT_TOO_LARGE", `Criterion 'jsonShape.requiredKeys' has ${keys.length} entries; limit is ${MAX_JSON_SHAPE_KEYS}.`);
        }
        requiredKeys = Object.freeze(keys.map((key, index) => {
            if (typeof key !== "string" || key === "" || key.length > MAX_CRITERION_TERM_CHARACTERS) {
                invalid(`Criterion 'jsonShape.requiredKeys' entry at index ${index} must be a bounded non-empty string.`);
            }
            return key;
        }));
    }
    return Object.freeze({
        ...(rootType === undefined ? {} : { rootType: rootType }),
        ...(requiredKeys === undefined ? {} : { requiredKeys }),
    });
}
function validateListShape(value) {
    if (value === undefined)
        return undefined;
    const shape = expectRecord(value, "INVALID_CRITERIA", "Criterion 'listShape'");
    rejectUnknownKeys(shape, ["minItems", "maxItems"], "INVALID_CRITERIA", "Criterion 'listShape'");
    const minItems = validateOptionalNonNegativeInteger("Criterion 'listShape.minItems'", readOwnField(shape, "minItems"));
    const maxItems = validateOptionalNonNegativeInteger("Criterion 'listShape.maxItems'", readOwnField(shape, "maxItems"));
    if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
        invalid("Criterion 'listShape.minItems' cannot exceed 'listShape.maxItems'.");
    }
    return Object.freeze({
        ...(minItems === undefined ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
    });
}
function validateWeights(value) {
    if (value === undefined)
        return undefined;
    const weights = expectRecord(value, "INVALID_CRITERIA", "Criterion 'weights'");
    rejectUnknownKeys(weights, BUILTIN_CRITERION_NAMES, "INVALID_CRITERIA", "Criterion 'weights'");
    const checked = {};
    for (const name of ownPropertyNames(weights, "INVALID_CRITERIA", "Criterion 'weights'")) {
        checked[name] = validateWeight(`Criterion weight '${name}'`, readOwnField(weights, name));
    }
    return Object.freeze(checked);
}
function validateCustom(value) {
    if (value === undefined)
        return undefined;
    const entries = expectDenseArray(value, "INVALID_CRITERIA", "Criterion 'custom'");
    if (entries.length > MAX_CUSTOM_CRITERIA) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Criterion 'custom' has ${entries.length} entries; limit is ${MAX_CUSTOM_CRITERIA}.`);
    }
    const ids = new Set();
    const checked = entries.map((entry, index) => {
        const label = `Custom criterion at index ${index}`;
        const definition = expectRecord(entry, "INVALID_CRITERIA", label);
        rejectUnknownKeys(definition, ["id", "weight", "kind", "value", "caseSensitive"], "INVALID_CRITERIA", label);
        const id = expectString(readOwnField(definition, "id"), "INVALID_CRITERIA", `${label} id`);
        if (!CRITERION_ID.test(id) || id.length > 128)
            invalid(`${label} id '${id}' must match [A-Za-z][A-Za-z0-9_.-]* and be at most 128 characters.`);
        if (ids.has(id))
            invalid(`Custom criterion id '${id}' is duplicated.`);
        ids.add(id);
        const weight = validateWeight(`${label} weight`, readOwnField(definition, "weight"));
        const kind = readOwnField(definition, "kind");
        if (!CUSTOM_KINDS.includes(kind)) {
            invalid(`${label} kind must be one of ${CUSTOM_KINDS.join(", ")}.`);
        }
        const term = expectString(readOwnField(definition, "value"), "INVALID_CRITERIA", `${label} value`);
        if (term === "")
            invalid(`${label} value cannot be empty.`);
        if (term.length > MAX_CRITERION_TERM_CHARACTERS) {
            throw new CoreValidationError("INPUT_TOO_LARGE", `${label} value is ${term.length} characters; limit is ${MAX_CRITERION_TERM_CHARACTERS}.`);
        }
        const caseSensitive = readOwnField(definition, "caseSensitive");
        if (caseSensitive !== undefined && typeof caseSensitive !== "boolean") {
            invalid(`${label} caseSensitive must be a boolean.`);
        }
        return Object.freeze({
            id,
            weight,
            kind: kind,
            value: term,
            ...(caseSensitive === undefined ? {} : { caseSensitive }),
        });
    });
    return Object.freeze(checked);
}
const PHASE1_KEYS = ["expectedFormat", "maxWords", "minWords", "requiredKeywords", "forbiddenPhrases"];
const PHASE2_KEYS = ["exactMatch", "maxCharacters", "minCharacters", "jsonShape", "listShape", "weights", "custom"];
export function validateEvaluationCriteria(value) {
    const criteria = expectRecord(value, "INVALID_CRITERIA", "Evaluation criteria");
    rejectUnknownKeys(criteria, [...PHASE1_KEYS, ...PHASE2_KEYS], "INVALID_CRITERIA", "Evaluation criteria");
    const phase1 = {};
    for (const key of PHASE1_KEYS) {
        if (hasOwnField(criteria, key))
            phase1[key] = readOwnField(criteria, key);
    }
    let base;
    try {
        base = validateDeterministicCriteria(phase1);
    }
    catch (error) {
        if (error instanceof CoreValidationError && error.code === "INVALID_FIXTURE") {
            throw new CoreValidationError("INVALID_CRITERIA", error.message);
        }
        throw error;
    }
    const exactMatch = readOwnField(criteria, "exactMatch");
    if (exactMatch !== undefined) {
        expectString(exactMatch, "INVALID_CRITERIA", "Criterion 'exactMatch'");
        if (exactMatch.length > MAX_FIXTURE_CHECK_CHARACTERS) {
            throw new CoreValidationError("INPUT_TOO_LARGE", `Criterion 'exactMatch' is ${exactMatch.length} characters; limit is ${MAX_FIXTURE_CHECK_CHARACTERS}.`);
        }
    }
    const maxCharacters = validateOptionalNonNegativeInteger("Criterion 'maxCharacters'", readOwnField(criteria, "maxCharacters"));
    const minCharacters = validateOptionalNonNegativeInteger("Criterion 'minCharacters'", readOwnField(criteria, "minCharacters"));
    if (minCharacters !== undefined && maxCharacters !== undefined && minCharacters > maxCharacters) {
        invalid("Criterion 'minCharacters' cannot exceed 'maxCharacters'.");
    }
    const jsonShape = validateJsonShape(readOwnField(criteria, "jsonShape"));
    const listShape = validateListShape(readOwnField(criteria, "listShape"));
    const weights = validateWeights(readOwnField(criteria, "weights"));
    const custom = validateCustom(readOwnField(criteria, "custom"));
    return Object.freeze({
        ...base,
        ...(exactMatch === undefined ? {} : { exactMatch: exactMatch }),
        ...(maxCharacters === undefined ? {} : { maxCharacters }),
        ...(minCharacters === undefined ? {} : { minCharacters }),
        ...(jsonShape === undefined ? {} : { jsonShape }),
        ...(listShape === undefined ? {} : { listShape }),
        ...(weights === undefined ? {} : { weights }),
        ...(custom === undefined ? {} : { custom }),
    });
}
function parseJsonSafely(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    }
    catch {
        return { ok: false };
    }
}
function listItems(text) {
    return nonEmptyLines(text).filter((line) => /^(?:[-*+]|\d+\.)\s+\S/u.test(line));
}
function fold(text, caseSensitive) {
    return caseSensitive ? text : text.toLowerCase();
}
function customPassed(text, definition) {
    const caseSensitive = readOwnField(definition, "caseSensitive") === true;
    const haystack = fold(text, caseSensitive);
    const needle = fold(definition.value, caseSensitive);
    switch (definition.kind) {
        case "includes":
            return haystack.includes(needle);
        case "excludes":
            return !haystack.includes(needle);
        case "equals":
            return haystack === needle;
        case "starts_with":
            return haystack.startsWith(needle);
        case "ends_with":
            return haystack.endsWith(needle);
    }
}
/**
 * Deterministically evaluates candidate output text against weighted criteria.
 * Output text is treated strictly as data; no part of it is interpreted or executed.
 */
export function evaluateOutput(text, criteria) {
    expectString(text, "INVALID_EVALUATION", "Candidate output text");
    if (text.length > MAX_FIXTURE_CHECK_CHARACTERS) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Candidate output is ${text.length} characters; limit is ${MAX_FIXTURE_CHECK_CHARACTERS}.`);
    }
    const checked = validateEvaluationCriteria(criteria);
    const weights = (readOwnField(checked, "weights") ?? {});
    const weightOf = (name) => {
        const override = readOwnField(weights, name);
        return typeof override === "number" ? override : 1;
    };
    const wordCount = countWords(text);
    const characterCount = text.length;
    const checks = [];
    const push = (id, criterion, passed, expected, actual) => {
        checks.push(Object.freeze({ id, criterion, weight: weightOf(criterion), passed, expected, actual }));
    };
    const expectedFormat = readOwnField(checked, "expectedFormat");
    if (expectedFormat !== undefined) {
        const passed = matchesFormat(text, expectedFormat);
        push("format", "format", passed, expectedFormat, passed);
    }
    const maxWords = readOwnField(checked, "maxWords");
    if (maxWords !== undefined)
        push("max_words", "max_words", wordCount <= maxWords, maxWords, wordCount);
    const minWords = readOwnField(checked, "minWords");
    if (minWords !== undefined)
        push("min_words", "min_words", wordCount >= minWords, minWords, wordCount);
    const foldedText = text.toLowerCase();
    const requiredKeywords = (readOwnField(checked, "requiredKeywords") ?? []);
    for (const [index, keyword] of requiredKeywords.entries()) {
        const passed = foldedText.includes(keyword.toLowerCase());
        push(`required_keyword.${index}`, "required_keyword", passed, keyword, passed);
    }
    const forbiddenPhrases = (readOwnField(checked, "forbiddenPhrases") ?? []);
    for (const [index, phrase] of forbiddenPhrases.entries()) {
        const passed = !foldedText.includes(phrase.toLowerCase());
        push(`forbidden_phrase.${index}`, "forbidden_phrase", passed, phrase, passed);
    }
    const exactMatch = readOwnField(checked, "exactMatch");
    if (exactMatch !== undefined) {
        const passed = text.trim() === exactMatch.trim();
        push("exact_match", "exact_match", passed, exactMatch, passed);
    }
    const maxCharacters = readOwnField(checked, "maxCharacters");
    if (maxCharacters !== undefined) {
        push("max_characters", "max_characters", characterCount <= maxCharacters, maxCharacters, characterCount);
    }
    const minCharacters = readOwnField(checked, "minCharacters");
    if (minCharacters !== undefined) {
        push("min_characters", "min_characters", characterCount >= minCharacters, minCharacters, characterCount);
    }
    const jsonShape = readOwnField(checked, "jsonShape");
    if (jsonShape !== undefined) {
        const parsed = parseJsonSafely(text);
        const rootType = readOwnField(jsonShape, "rootType");
        const requiredKeys = (readOwnField(jsonShape, "requiredKeys") ?? []);
        let passed = parsed.ok;
        let actual = "invalid_json";
        if (parsed.ok) {
            const value = parsed.value;
            const isArray = Array.isArray(value);
            const isObject = value !== null && typeof value === "object" && !isArray;
            actual = isArray ? "array" : isObject ? "object" : "scalar";
            if (rootType === "object" && !isObject)
                passed = false;
            if (rootType === "array" && !isArray)
                passed = false;
            if (requiredKeys.length > 0) {
                if (!isObject)
                    passed = false;
                else {
                    const missing = requiredKeys.filter((key) => !hasOwnField(value, key));
                    if (missing.length > 0) {
                        passed = false;
                        actual = `missing:${missing.join(",")}`;
                    }
                }
            }
        }
        const expected = `${rootType ?? "any"}${requiredKeys.length > 0 ? `[${requiredKeys.join(",")}]` : ""}`;
        push("json_shape", "json_shape", passed, expected, actual);
    }
    const listShape = readOwnField(checked, "listShape");
    if (listShape !== undefined) {
        const items = listItems(text).length;
        const minItems = readOwnField(listShape, "minItems");
        const maxItems = readOwnField(listShape, "maxItems");
        const passed = items > 0 && (minItems === undefined || items >= minItems) && (maxItems === undefined || items <= maxItems);
        push("list_shape", "list_shape", passed, `${minItems ?? 1}..${maxItems ?? "*"}`, items);
    }
    const custom = (readOwnField(checked, "custom") ?? []);
    for (const definition of custom) {
        const passed = customPassed(text, definition);
        checks.push(Object.freeze({
            id: `custom.${definition.id}`,
            criterion: "custom",
            weight: definition.weight,
            passed,
            expected: `${definition.kind}:${definition.value}`,
            actual: passed,
        }));
    }
    let totalWeight = 0;
    let passedWeight = 0;
    for (const check of checks) {
        totalWeight += check.weight;
        if (check.passed)
            passedWeight += check.weight;
    }
    const score = totalWeight > 0 ? passedWeight / totalWeight : null;
    return Object.freeze({
        passed: checks.every((check) => check.passed),
        wordCount,
        characterCount,
        checks: Object.freeze(checks),
        totalWeight,
        passedWeight,
        score,
    });
}
// ---------------------------------------------------------------------------
// Suites, cases, and candidates
// ---------------------------------------------------------------------------
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
function validateOptionalText(value, label, limit) {
    if (value === undefined)
        return undefined;
    const text = expectString(value, "INVALID_EVALUATION", label);
    if (text.length > limit) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `${label} is ${text.length} characters; limit is ${limit}.`);
    }
    return text;
}
export function validateEvaluationCase(value) {
    const record = expectRecord(value, "INVALID_EVALUATION", "Evaluation case");
    rejectUnknownKeys(record, ["id", "name", "completionFixtureId", "criteria", "input", "expectedOutput", "judgeRubric"], "INVALID_EVALUATION", "Evaluation case");
    const id = expectString(readOwnField(record, "id"), "INVALID_EVALUATION", "Evaluation case id");
    if (!CASE_ID.test(id) || id.length > 128) {
        throw new CoreValidationError("INVALID_EVALUATION", `Evaluation case id '${id}' must match [A-Za-z0-9][A-Za-z0-9_.-]* and be at most 128 characters.`);
    }
    const name = expectString(readOwnField(record, "name"), "INVALID_EVALUATION", `Evaluation case '${id}' name`);
    const completionFixtureId = expectString(readOwnField(record, "completionFixtureId"), "INVALID_EVALUATION", `Evaluation case '${id}' completionFixtureId`);
    const criteria = validateEvaluationCriteria(readOwnField(record, "criteria"));
    const input = validateOptionalText(readOwnField(record, "input"), `Evaluation case '${id}' input`, MAX_CASE_INPUT_CHARACTERS);
    const expectedOutput = validateOptionalText(readOwnField(record, "expectedOutput"), `Evaluation case '${id}' expectedOutput`, MAX_CASE_INPUT_CHARACTERS);
    const judgeRubric = validateOptionalText(readOwnField(record, "judgeRubric"), `Evaluation case '${id}' judgeRubric`, MAX_CASE_INPUT_CHARACTERS);
    return Object.freeze({
        id,
        name,
        completionFixtureId,
        criteria,
        ...(input === undefined ? {} : { input }),
        ...(expectedOutput === undefined ? {} : { expectedOutput }),
        ...(judgeRubric === undefined ? {} : { judgeRubric }),
    });
}
export function validateEvaluationSuite(value) {
    const record = expectRecord(value, "INVALID_EVALUATION", "Evaluation suite");
    rejectUnknownKeys(record, ["id", "cases"], "INVALID_EVALUATION", "Evaluation suite");
    const id = expectString(readOwnField(record, "id"), "INVALID_EVALUATION", "Evaluation suite id");
    if (!CASE_ID.test(id) || id.length > 128) {
        throw new CoreValidationError("INVALID_EVALUATION", `Evaluation suite id '${id}' must match [A-Za-z0-9][A-Za-z0-9_.-]* and be at most 128 characters.`);
    }
    const cases = expectDenseArray(readOwnField(record, "cases"), "INVALID_EVALUATION", `Evaluation suite '${id}' cases`);
    if (cases.length > MAX_EVALUATION_CASES) {
        throw new CoreValidationError("BUDGET_EXCEEDED", `Evaluation suite '${id}' has ${cases.length} cases; limit is ${MAX_EVALUATION_CASES}.`);
    }
    const ids = new Set();
    const checkedCases = cases.map((entry) => {
        const checked = validateEvaluationCase(entry);
        if (ids.has(checked.id)) {
            throw new CoreValidationError("INVALID_EVALUATION", `Evaluation case id '${checked.id}' is duplicated in suite '${id}'.`);
        }
        ids.add(checked.id);
        return checked;
    });
    return Object.freeze({ id, cases: Object.freeze(checkedCases) });
}
export function validatePromptCandidate(value) {
    const record = expectRecord(value, "INVALID_CANDIDATE", "Prompt candidate");
    rejectUnknownKeys(record, ["id", "prompt", "origin", "parentCandidateId", "metadata"], "INVALID_CANDIDATE", "Prompt candidate");
    const id = expectString(readOwnField(record, "id"), "INVALID_CANDIDATE", "Prompt candidate id");
    if (!CASE_ID.test(id) || id.length > 128) {
        throw new CoreValidationError("INVALID_CANDIDATE", `Prompt candidate id '${id}' must match [A-Za-z0-9][A-Za-z0-9_.-]* and be at most 128 characters.`);
    }
    const prompt = expectRecord(readOwnField(record, "prompt"), "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt`);
    rejectUnknownKeys(prompt, ["pattern", "text", "variablesUsed"], "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt`);
    const pattern = expectString(readOwnField(prompt, "pattern"), "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt.pattern`);
    const text = expectString(readOwnField(prompt, "text"), "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt.text`);
    if (text.length > MAX_EVALUATION_PROMPT_CHARACTERS) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Prompt candidate '${id}' prompt is ${text.length} characters; limit is ${MAX_EVALUATION_PROMPT_CHARACTERS}.`);
    }
    const variablesUsed = expectDenseArray(readOwnField(prompt, "variablesUsed"), "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt.variablesUsed`).map((entry, index) => expectString(entry, "INVALID_CANDIDATE", `Prompt candidate '${id}' prompt.variablesUsed[${index}]`));
    const origin = readOwnField(record, "origin");
    if (origin !== "rendered" && origin !== "fixture" && origin !== "explicit_generation") {
        throw new CoreValidationError("INVALID_CANDIDATE", `Prompt candidate '${id}' origin must be rendered, fixture, or explicit_generation.`);
    }
    const parentCandidateId = readOwnField(record, "parentCandidateId");
    if (parentCandidateId !== undefined) {
        expectString(parentCandidateId, "INVALID_CANDIDATE", `Prompt candidate '${id}' parentCandidateId`);
    }
    const metadataValue = readOwnField(record, "metadata");
    let metadata;
    if (metadataValue !== undefined) {
        const source = expectRecord(metadataValue, "INVALID_CANDIDATE", `Prompt candidate '${id}' metadata`);
        metadata = {};
        for (const key of ownPropertyNames(source, "INVALID_CANDIDATE", `Prompt candidate '${id}' metadata`)) {
            const entry = readOwnField(source, key);
            if (typeof entry !== "string" && typeof entry !== "boolean" && !(typeof entry === "number" && Number.isFinite(entry))) {
                throw new CoreValidationError("INVALID_CANDIDATE", `Prompt candidate '${id}' metadata field '${key}' must be a string, finite number, or boolean.`);
            }
            Object.defineProperty(metadata, key, { configurable: true, enumerable: true, value: entry, writable: true });
        }
    }
    return Object.freeze({
        id,
        prompt: Object.freeze({ pattern, text, variablesUsed: Object.freeze(variablesUsed) }),
        origin,
        ...(parentCandidateId === undefined ? {} : { parentCandidateId: parentCandidateId }),
        ...(metadata === undefined ? {} : { metadata: Object.freeze(metadata) }),
    });
}
// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------
export function measured(value) {
    return Object.freeze({ status: "measured", value });
}
export function unknownMeasurement(reason) {
    return Object.freeze({ status: "unknown", reason });
}
function nonNegativeMeasurement(value, label, integer) {
    if (value === undefined)
        return unknownMeasurement(`${label} was not reported`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
        return unknownMeasurement(`${label} was not a valid non-negative ${integer ? "integer" : "number"}`);
    }
    return measured(value);
}
export function measureCompletion(result) {
    const latencyMs = nonNegativeMeasurement(readOwnField(result, "latencyMs"), "latencyMs", true);
    const usage = readOwnField(result, "usage");
    const usageRecord = usage !== null && typeof usage === "object" && !Array.isArray(usage) ? usage : undefined;
    const inputTokens = usageRecord
        ? nonNegativeMeasurement(readOwnField(usageRecord, "inputTokens"), "usage.inputTokens", true)
        : unknownMeasurement("usage was not reported");
    const outputTokens = usageRecord
        ? nonNegativeMeasurement(readOwnField(usageRecord, "outputTokens"), "usage.outputTokens", true)
        : unknownMeasurement("usage was not reported");
    const totalTokens = inputTokens.status === "measured" && outputTokens.status === "measured"
        ? Number.isSafeInteger(inputTokens.value + outputTokens.value)
            ? measured(inputTokens.value + outputTokens.value)
            : unknownMeasurement("total token usage exceeds the safe integer range")
        : unknownMeasurement("input or output token usage is unknown");
    const costUsd = nonNegativeMeasurement(readOwnField(result, "costUsd"), "costUsd", false);
    return Object.freeze({ latencyMs, inputTokens, outputTokens, totalTokens, costUsd });
}
export function meanMeasurement(values, label) {
    if (values.length === 0)
        return unknownMeasurement(`no ${label} measurements`);
    const unknownCount = values.filter((value) => value.status === "unknown").length;
    if (unknownCount > 0) {
        return unknownMeasurement(`${label} is unknown for ${unknownCount} of ${values.length} cases`);
    }
    let total = 0;
    for (const value of values) {
        if (value.status !== "measured")
            continue;
        const nextTotal = total + value.value;
        if (label === "totalTokens" && (!Number.isSafeInteger(value.value) || !Number.isSafeInteger(nextTotal))) {
            return unknownMeasurement(`${label} aggregate exceeds the safe integer range`);
        }
        total = nextTotal;
    }
    return measured(total / values.length);
}
function validateOptions(value) {
    if (value === undefined)
        return Object.freeze({});
    const options = expectRecord(value, "INVALID_EVALUATION", "Evaluate options");
    rejectUnknownKeys(options, ["judge", "model", "maxOutputCharacters", "signal", "timeoutMs"], "INVALID_EVALUATION", "Evaluate options");
    const judge = readOwnField(options, "judge");
    if (judge !== undefined &&
        (judge === null || typeof judge !== "object" || typeof judge.judge !== "function")) {
        throw new CoreValidationError("INVALID_EVALUATION", "Evaluate option 'judge' must expose a judge(request) method.");
    }
    const model = readOwnField(options, "model");
    if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
        throw new CoreValidationError("INVALID_EVALUATION", "Evaluate option 'model' must be a non-empty string when present.");
    }
    if (typeof model === "string" && model.length > MAX_COMPLETION_MODEL_CHARACTERS) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Evaluate option 'model' is ${model.length} characters; limit is ${MAX_COMPLETION_MODEL_CHARACTERS}.`);
    }
    const maxOutputCharacters = readOwnField(options, "maxOutputCharacters");
    if (maxOutputCharacters !== undefined &&
        (!Number.isSafeInteger(maxOutputCharacters) || maxOutputCharacters <= 0)) {
        throw new CoreValidationError("INVALID_EVALUATION", "Evaluate option 'maxOutputCharacters' must be a positive safe integer.");
    }
    if (maxOutputCharacters !== undefined &&
        maxOutputCharacters > MAX_COMPLETION_OUTPUT_CHARACTERS) {
        throw new CoreValidationError("OUTPUT_TOO_LARGE", `Evaluate option 'maxOutputCharacters' is ${maxOutputCharacters}; limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}.`);
    }
    const signal = readOwnField(options, "signal");
    if (signal !== undefined &&
        (signal === null ||
            typeof signal !== "object" ||
            typeof signal.aborted !== "boolean" ||
            typeof signal.addEventListener !== "function" ||
            typeof signal.removeEventListener !== "function")) {
        throw new CoreValidationError("INVALID_EVALUATION", "Evaluate option 'signal' must be an AbortSignal.");
    }
    const timeoutMs = readOwnField(options, "timeoutMs");
    if (timeoutMs !== undefined &&
        (typeof timeoutMs !== "number" ||
            !Number.isSafeInteger(timeoutMs) ||
            timeoutMs < 0 ||
            timeoutMs > MAX_COMPLETION_TIMEOUT_MS)) {
        throw new CoreValidationError("INVALID_EVALUATION", `Evaluate option 'timeoutMs' must be an integer between 0 and ${MAX_COMPLETION_TIMEOUT_MS}.`);
    }
    return Object.freeze({
        ...(judge === undefined ? {} : { judge: judge }),
        ...(model === undefined ? {} : { model: model }),
        ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters: maxOutputCharacters }),
        ...(signal === undefined ? {} : { signal: signal }),
        ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs }),
    });
}
function validateCompletionAdapter(value) {
    if (value === null || typeof value !== "object" || typeof value.complete !== "function") {
        throw new CoreValidationError("INVALID_EVALUATION", "Completion adapter must expose a complete(request, signal?) method.");
    }
    return value;
}
const EVALUATION_INPUT_PREFIX = "\n\n<evaluation_input>\n";
const EVALUATION_INPUT_SUFFIX = "\n</evaluation_input>";
function evaluationPromptLength(candidate, evaluationCase) {
    const input = readOwnField(evaluationCase, "input");
    if (input === undefined)
        return candidate.prompt.text.length;
    return candidate.prompt.text.length + EVALUATION_INPUT_PREFIX.length + encodedTemplateValueLength(input) + EVALUATION_INPUT_SUFFIX.length;
}
function preflightEvaluationPrompt(candidate, evaluationCase) {
    const length = evaluationPromptLength(candidate, evaluationCase);
    if (length > MAX_EVALUATION_PROMPT_CHARACTERS) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Evaluation prompt for candidate '${candidate.id}' and case '${evaluationCase.id}' is ${length} characters; limit is ${MAX_EVALUATION_PROMPT_CHARACTERS}.`);
    }
}
/** Builds the prompt sent to the completion adapter. Case input is escaped and delimited as data. */
export function buildEvaluationPrompt(candidate, evaluationCase) {
    const input = readOwnField(evaluationCase, "input");
    preflightEvaluationPrompt(candidate, evaluationCase);
    const prompt = input === undefined
        ? candidate.prompt.text
        : `${candidate.prompt.text}${EVALUATION_INPUT_PREFIX}${escapeTemplateValue(input)}${EVALUATION_INPUT_SUFFIX}`;
    return prompt;
}
function buildCompletionRequest(candidate, evaluationCase, options) {
    const prompt = buildEvaluationPrompt(candidate, evaluationCase);
    const model = readOwnField(options, "model");
    const maxOutputCharacters = readOwnField(options, "maxOutputCharacters");
    return {
        fixtureId: evaluationCase.completionFixtureId,
        ...(model === undefined ? {} : { model }),
        prompt,
        ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters }),
    };
}
/** Validates every evaluation prompt and request option before the first completion can run. */
export function preflightEvaluationRequests(adapter, candidates, suite, options) {
    validateCompletionAdapter(adapter);
    const checkedOptions = validateOptions(options);
    for (const candidate of candidates) {
        for (const evaluationCase of suite.cases)
            preflightEvaluationPrompt(candidate, evaluationCase);
    }
    return checkedOptions;
}
export async function evaluateCase(adapter, candidate, evaluationCase, options) {
    const checkedCandidate = validatePromptCandidate(candidate);
    const checkedCase = validateEvaluationCase(evaluationCase);
    const checkedOptions = validateOptions(options);
    const checkedAdapter = validateCompletionAdapter(adapter);
    const request = buildCompletionRequest(checkedCandidate, checkedCase, checkedOptions);
    const normalizedRequest = normalizeCompletionRequest(request);
    const outputLimit = readOwnField(checkedOptions, "maxOutputCharacters") ?? MAX_COMPLETION_OUTPUT_CHARACTERS;
    const timeoutMs = readOwnField(checkedOptions, "timeoutMs");
    const signal = readOwnField(checkedOptions, "signal");
    if (timeoutMs === undefined)
        throwIfCompletionAborted(signal);
    const result = timeoutMs === undefined
        ? validateCompletionResult(await checkedAdapter.complete(normalizedRequest, signal), outputLimit)
        : await completeWithTimeout(checkedAdapter, normalizedRequest, {
            timeoutMs,
            ...(signal === undefined ? {} : { signal }),
        });
    const text = readOwnField(result, "text");
    const model = readOwnField(result, "model") ?? null;
    const finishReason = readOwnField(result, "finishReason") ?? null;
    const deterministic = evaluateOutput(text, checkedCase.criteria);
    const measurements = measureCompletion(result);
    const judge = readOwnField(checkedOptions, "judge");
    const rubric = readOwnField(checkedCase, "judgeRubric");
    let judgeOutcome;
    if (judge === undefined) {
        judgeOutcome = Object.freeze({ status: "not_requested" });
    }
    else if (rubric === undefined) {
        judgeOutcome = Object.freeze({ status: "skipped", reason: "case has no judgeRubric" });
    }
    else {
        const request = buildJudgeRequest({
            caseId: checkedCase.id,
            candidateId: checkedCandidate.id,
            rubric,
            input: readOwnField(checkedCase, "input") ?? null,
            expectedOutput: readOwnField(checkedCase, "expectedOutput") ?? null,
            candidateOutput: text,
        });
        judgeOutcome = request.status === "skipped" ? request.outcome : await runSemanticJudge(judge, request.request);
    }
    return Object.freeze({
        caseId: checkedCase.id,
        candidateId: checkedCandidate.id,
        completionFixtureId: checkedCase.completionFixtureId,
        model,
        finishReason,
        outputCharacters: text.length,
        deterministic,
        judge: judgeOutcome,
        measurements,
    });
}
export function aggregateCases(cases) {
    const deterministicScores = cases.map((entry) => entry.deterministic.score === null
        ? unknownMeasurement(`case '${entry.caseId}' has no weighted criteria`)
        : measured(entry.deterministic.score));
    const judgeScores = cases.map((entry) => entry.judge.status === "judged"
        ? measured(entry.judge.score)
        : unknownMeasurement(`case '${entry.caseId}' judge status is ${entry.judge.status}`));
    return Object.freeze({
        caseCount: cases.length,
        passedCaseCount: cases.filter((entry) => entry.deterministic.passed).length,
        deterministicScore: meanMeasurement(deterministicScores, "deterministic score"),
        judgeScore: meanMeasurement(judgeScores, "judge score"),
        latencyMs: meanMeasurement(cases.map((entry) => entry.measurements.latencyMs), "latencyMs"),
        totalTokens: meanMeasurement(cases.map((entry) => entry.measurements.totalTokens), "totalTokens"),
        costUsd: meanMeasurement(cases.map((entry) => entry.measurements.costUsd), "costUsd"),
    });
}
export async function evaluateCandidate(adapter, candidate, suite, options) {
    const checkedSuite = validateEvaluationSuite(suite);
    const checkedCandidate = validatePromptCandidate(candidate);
    const checkedOptions = preflightEvaluationRequests(adapter, [checkedCandidate], checkedSuite, options);
    const cases = [];
    for (const evaluationCase of checkedSuite.cases) {
        cases.push(await evaluateCase(adapter, checkedCandidate, evaluationCase, checkedOptions));
    }
    return Object.freeze({
        candidateId: checkedCandidate.id,
        cases: Object.freeze(cases),
        aggregate: aggregateCases(cases),
    });
}
export async function evaluateSuite(adapter, candidates, suite, options) {
    const checkedSuite = validateEvaluationSuite(suite);
    const checkedCandidates = expectDenseArray(candidates, "INVALID_CANDIDATE", "Prompt candidates").map(validatePromptCandidate);
    if (checkedCandidates.length > MAX_EVALUATION_CANDIDATES) {
        throw new CoreValidationError("BUDGET_EXCEEDED", `${checkedCandidates.length} candidates exceed the limit of ${MAX_EVALUATION_CANDIDATES}.`);
    }
    const ids = new Set();
    for (const candidate of checkedCandidates) {
        if (ids.has(candidate.id))
            throw new CoreValidationError("INVALID_CANDIDATE", `Prompt candidate id '${candidate.id}' is duplicated.`);
        ids.add(candidate.id);
    }
    const checkedOptions = preflightEvaluationRequests(adapter, checkedCandidates, checkedSuite, options);
    const completions = checkedCandidates.length * checkedSuite.cases.length;
    if (completions > MAX_EVALUATION_COMPLETIONS) {
        throw new CoreValidationError("BUDGET_EXCEEDED", `${checkedCandidates.length} candidates x ${checkedSuite.cases.length} cases = ${completions} completions; limit is ${MAX_EVALUATION_COMPLETIONS}.`);
    }
    const evaluations = [];
    for (const candidate of checkedCandidates) {
        evaluations.push(await evaluateCandidate(adapter, candidate, checkedSuite, checkedOptions));
    }
    return Object.freeze({
        suiteId: checkedSuite.id,
        candidates: Object.freeze(evaluations),
        completionsUsed: completions,
    });
}
