import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEvaluationSuite } from "../core/evaluation.js";
import type { EvaluationSuite } from "../core/types.js";
import { flagValues, singleFlag, type ParsedArgs } from "./args.js";
import { CliError } from "./errors.js";
import { stringifyCliJsonLine } from "./json.js";

export interface CliIo {
  readonly stdin: ReadableLike;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly cwd: string;
}

export const MAX_CLI_PROMPT_CHARACTERS = 16_384;
const PROMPT_READ_CHUNK_BYTES = 4_096;
export const MAX_CLI_SUITE_JSON_BYTES = 8 * 1024 * 1024;

export async function writeStream(stream: WritableLike, text: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    stream.write(text, (error?: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function promptTooLargeError(): CliError {
  return new CliError("INPUT_TOO_LARGE", `Prompt input exceeds ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.`);
}

function appendBoundedPromptText(current: string, chunk: string): { readonly text: string; readonly tooLarge: boolean } {
  const allowedCharacters = MAX_CLI_PROMPT_CHARACTERS + 1 - current.length;
  if (allowedCharacters <= 0) return { text: current, tooLarge: true };
  const text = current + chunk.slice(0, allowedCharacters);
  return { text, tooLarge: text.length > MAX_CLI_PROMPT_CHARACTERS };
}

async function readBoundedPromptStream(stream: ReadableLike): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    let text = "";
    let settled = false;

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      stream.destroy?.(error);
      reject(error);
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      const next = appendBoundedPromptText(text, chunk);
      text = next.text;
      if (next.tooLarge) rejectOnce(promptTooLargeError());
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolvePromise(text);
    });
    stream.on("error", rejectOnce);
  });
}

export async function readStdin(stdin: ReadableLike): Promise<string> {
  if (stdin.isTTY === true) return "";
  stdin.setEncoding("utf8");
  return await readBoundedPromptStream(stdin);
}

export async function readPromptFile(path: string): Promise<string> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: PROMPT_READ_CHUNK_BYTES });
  return await readBoundedPromptStream(stream);
}

function suiteTooLargeError(path: string): CliError {
  return new CliError("INPUT_TOO_LARGE", `Suite file '${path}' exceeds ${MAX_CLI_SUITE_JSON_BYTES} bytes.`);
}

async function readBoundedUtf8File(path: string, displayPath: string, maxBytes: number): Promise<string> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: PROMPT_READ_CHUNK_BYTES });
  return await new Promise((resolvePromise, reject) => {
    let text = "";
    let bytes = 0;
    let settled = false;

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      stream.destroy?.(error);
      reject(error);
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maxBytes) {
        rejectOnce(suiteTooLargeError(displayPath));
        return;
      }
      text += chunk;
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolvePromise(text);
    });
    stream.on("error", rejectOnce);
  });
}

export async function loadPrompt(args: ParsedArgs, io: CliIo): Promise<string> {
  const promptValues = flagValues(args, "prompt");
  const fileValues = flagValues(args, "prompt-file");
  if (promptValues.length > 1) throw new CliError("INVALID_ARGUMENT", "Flag --prompt may be provided at most once.");
  if (fileValues.length > 1) throw new CliError("INVALID_ARGUMENT", "Flag --prompt-file may be provided at most once.");

  const explicitSources = Number(promptValues.length === 1) + Number(fileValues.length === 1);
  const stdinText = await readStdin(io.stdin);
  const hasStdin = stdinText.trim() !== "";
  if (explicitSources + Number(hasStdin) > 1) {
    throw new CliError("AMBIGUOUS_INPUT", "Provide prompt input from exactly one source: --prompt, --prompt-file, or stdin.");
  }

  let prompt: string;
  if (promptValues[0] !== undefined) prompt = promptValues[0];
  else if (fileValues[0] !== undefined) prompt = await readPromptFile(resolve(io.cwd, fileValues[0]));
  else if (hasStdin) prompt = stdinText;
  else throw new CliError("MISSING_INPUT", "Provide prompt input from --prompt, --prompt-file, or stdin.");

  if (prompt.trim() === "") throw new CliError("MISSING_INPUT", "Prompt input cannot be empty.");
  if (prompt.length > MAX_CLI_PROMPT_CHARACTERS) {
    throw new CliError(
      "INPUT_TOO_LARGE",
      `Prompt input is ${prompt.length} UTF-16 characters; limit is ${MAX_CLI_PROMPT_CHARACTERS}.`,
    );
  }
  return prompt;
}

export async function loadSuite(args: ParsedArgs, io: CliIo): Promise<EvaluationSuite> {
  const path = singleFlag(args, "suite");
  if (path === undefined) throw new CliError("MISSING_ARGUMENT", "Flag --suite <file.json> is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBoundedUtf8File(resolve(io.cwd, path), path, MAX_CLI_SUITE_JSON_BYTES)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError("INVALID_JSON", `Suite file '${path}' is not valid JSON.`);
    throw error;
  }
  const suite = validateEvaluationSuite(parsed);
  if (suite.cases.length === 0) throw new CliError("INVALID_ARGUMENT", `Suite '${suite.id}' must include at least one case.`);
  return suite;
}

export function validateOutputFlag(args: ParsedArgs): void {
  const values = flagValues(args, "output");
  if (values.length > 1) throw new CliError("INVALID_ARGUMENT", "Flag --output may be provided at most once.");
}

export async function writeJsonOutput(args: ParsedArgs, io: CliIo, value: unknown): Promise<string | undefined> {
  const output = singleFlag(args, "output");
  if (output === undefined) return undefined;
  const path = resolve(io.cwd, output);
  const json = stringifyCliJsonLine(value);
  await writeFile(path, json, "utf8");
  return path;
}
