import { CoreValidationError } from "./errors.js";
import {
  expectDenseArray,
  expectRecord,
  expectString,
  readOwnField,
  rejectUnknownKeys,
} from "./validation.js";
import type {
  CriterionCheck,
  DeterministicCriteria,
  ExpectedFormat,
  FixtureCheckResult,
} from "./types.js";

export const MAX_FIXTURE_CHECK_CHARACTERS = 48_000;
export const MAX_CRITERION_TERM_COUNT = 128;
export const MAX_CRITERION_TERM_CHARACTERS = 1_024;
export const MAX_CRITERION_TOTAL_TERM_CHARACTERS = 16_384;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function nonEmptyLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function matchesFormat(text: string, format: ExpectedFormat): boolean {
  if (format === "json") return isJson(text);
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return false;
  if (format === "bullet_list") return lines.every((line) => /^[-*+]\s+\S/u.test(line));
  return lines.every((line, index) => {
    const match = /^(\d+)\.\s+\S/u.exec(line);
    return match !== null && Number(match[1]) === index + 1;
  });
}

export function validateDeterministicCriteria(value: unknown): DeterministicCriteria {
  const criteria = expectRecord(value, "INVALID_FIXTURE", "Fixture criteria");
  rejectUnknownKeys(
    criteria,
    ["expectedFormat", "maxWords", "minWords", "requiredKeywords", "forbiddenPhrases"],
    "INVALID_FIXTURE",
    "Fixture criteria",
  );
  const expectedFormatValue = readOwnField(criteria, "expectedFormat");
  if (
    expectedFormatValue !== undefined &&
    expectedFormatValue !== "json" &&
    expectedFormatValue !== "bullet_list" &&
    expectedFormatValue !== "numbered_list"
  ) {
    throw new CoreValidationError(
      "INVALID_FIXTURE",
      "Unsupported expected format; expected one of json, bullet_list, or numbered_list.",
    );
  }
  const maxWordsValue = readOwnField(criteria, "maxWords");
  const minWordsValue = readOwnField(criteria, "minWords");
  for (const [name, value] of [
    ["maxWords", maxWordsValue],
    ["minWords", minWordsValue],
  ] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
      throw new CoreValidationError(
        "INVALID_FIXTURE",
        `Criterion '${name}' must be a non-negative safe integer.`,
      );
    }
  }
  if (
    minWordsValue !== undefined &&
    maxWordsValue !== undefined &&
    (minWordsValue as number) > (maxWordsValue as number)
  ) {
    throw new CoreValidationError(
      "INVALID_FIXTURE",
      "Criterion 'minWords' cannot exceed 'maxWords'.",
    );
  }
  let totalTermCount = 0;
  let totalTermCharacters = 0;
  let requiredKeywords: readonly string[] | undefined;
  let forbiddenPhrases: readonly string[] | undefined;
  for (const [name, terms] of [
    ["requiredKeywords", readOwnField(criteria, "requiredKeywords")],
    ["forbiddenPhrases", readOwnField(criteria, "forbiddenPhrases")],
  ] as const) {
    if (terms !== undefined) {
      const checkedTerms = expectDenseArray(terms, "INVALID_FIXTURE", `Criterion '${name}'`);
      totalTermCount += checkedTerms.length;
      if (totalTermCount > MAX_CRITERION_TERM_COUNT) {
        throw new CoreValidationError(
          "INPUT_TOO_LARGE",
          `Criterion term count is ${totalTermCount}; limit is ${MAX_CRITERION_TERM_COUNT}.`,
        );
      }
      for (const [index, term] of checkedTerms.entries()) {
        if (typeof term !== "string" || term.trim() === "") {
          throw new CoreValidationError(
            "INVALID_FIXTURE",
            `Criterion '${name}' entry at index ${index} must be a non-empty string.`,
          );
        }
        if (term.length > MAX_CRITERION_TERM_CHARACTERS) {
          throw new CoreValidationError(
            "INPUT_TOO_LARGE",
            `Criterion '${name}' entry at index ${index} is ${term.length} characters; limit is ${MAX_CRITERION_TERM_CHARACTERS}.`,
          );
        }
        totalTermCharacters += term.length;
        if (totalTermCharacters > MAX_CRITERION_TOTAL_TERM_CHARACTERS) {
          throw new CoreValidationError(
            "INPUT_TOO_LARGE",
            `Criterion terms total ${totalTermCharacters} characters; limit is ${MAX_CRITERION_TOTAL_TERM_CHARACTERS}.`,
          );
        }
      }
      const normalizedTerms = Object.freeze(checkedTerms.map((term) => term as string));
      if (name === "requiredKeywords") requiredKeywords = normalizedTerms;
      else forbiddenPhrases = normalizedTerms;
    }
  }
  const expectedFormat = expectedFormatValue as DeterministicCriteria["expectedFormat"];
  const maxWords = maxWordsValue as number | undefined;
  const minWords = minWordsValue as number | undefined;
  return {
    ...(expectedFormat === undefined ? {} : { expectedFormat }),
    ...(maxWords === undefined ? {} : { maxWords }),
    ...(minWords === undefined ? {} : { minWords }),
    ...(requiredKeywords === undefined ? {} : { requiredKeywords }),
    ...(forbiddenPhrases === undefined ? {} : { forbiddenPhrases }),
  };
}

export function checkFixtureOutput(
  text: string,
  criteria: DeterministicCriteria,
): FixtureCheckResult {
  expectString(text, "INVALID_FIXTURE", "Fixture output text");
  if (text.length > MAX_FIXTURE_CHECK_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Fixture output is ${text.length} characters; limit is ${MAX_FIXTURE_CHECK_CHARACTERS}.`,
    );
  }
  const checkedCriteria = validateDeterministicCriteria(criteria);
  const wordCount = countWords(text);
  const checks: CriterionCheck[] = [];
  const expectedFormat = readOwnField(checkedCriteria, "expectedFormat") as ExpectedFormat | undefined;
  const maxWords = readOwnField(checkedCriteria, "maxWords") as number | undefined;
  const minWords = readOwnField(checkedCriteria, "minWords") as number | undefined;
  const requiredKeywords = readOwnField(checkedCriteria, "requiredKeywords") as readonly string[] | undefined;
  const forbiddenPhrases = readOwnField(checkedCriteria, "forbiddenPhrases") as readonly string[] | undefined;

  if (expectedFormat !== undefined) {
    const passed = matchesFormat(text, expectedFormat);
    checks.push({
      criterion: "format",
      passed,
      expected: expectedFormat,
      actual: passed,
    });
  }
  if (maxWords !== undefined) {
    checks.push({
      criterion: "max_words",
      passed: wordCount <= maxWords,
      expected: maxWords,
      actual: wordCount,
    });
  }
  if (minWords !== undefined) {
    checks.push({
      criterion: "min_words",
      passed: wordCount >= minWords,
      expected: minWords,
      actual: wordCount,
    });
  }

  const foldedText = text.toLowerCase();
  for (const keyword of requiredKeywords ?? []) {
    const passed = foldedText.includes(keyword.toLowerCase());
    checks.push({
      criterion: "required_keyword",
      passed,
      expected: keyword,
      actual: passed,
    });
  }
  for (const phrase of forbiddenPhrases ?? []) {
    const passed = !foldedText.includes(phrase.toLowerCase());
    checks.push({
      criterion: "forbidden_phrase",
      passed,
      expected: phrase,
      actual: passed,
    });
  }

  return Object.freeze({
    passed: checks.every((check) => check.passed),
    wordCount,
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
  });
}
