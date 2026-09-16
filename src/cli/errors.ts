export type CliErrorCode =
  | "AMBIGUOUS_INPUT"
  | "INPUT_TOO_LARGE"
  | "INVALID_ARGUMENT"
  | "INVALID_JSON"
  | "INVALID_JSON_OUTPUT"
  | "MISSING_ARGUMENT"
  | "MISSING_INPUT"
  | "OUTPUT_TOO_LARGE";

export class CliError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}
