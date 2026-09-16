export type CoreErrorCode =
  | "UNKNOWN_PATTERN"
  | "MISSING_VARIABLES"
  | "UNKNOWN_VARIABLES"
  | "INVALID_VARIABLE_VALUE"
  | "MALFORMED_TEMPLATE"
  | "INVALID_PATTERN"
  | "INPUT_TOO_LARGE"
  | "OUTPUT_TOO_LARGE"
  | "UNKNOWN_FIXTURE"
  | "INVALID_FIXTURE"
  | "NON_CANONICAL_VALUE"
  | "INVALID_CRITERIA"
  | "INVALID_EVALUATION"
  | "INVALID_OBJECTIVE"
  | "INVALID_CANDIDATE"
  | "BUDGET_EXCEEDED";

export class CoreValidationError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = "CoreValidationError";
    this.code = code;
  }
}
