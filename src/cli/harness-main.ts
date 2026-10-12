import process from "node:process";
import { MAX_COMPLETION_OUTPUT_CHARACTERS } from "../adapters/completion.js";
import { CoreValidationError } from "../core/errors.js";
import { MAX_EVALUATION_CANDIDATES } from "../core/evaluation.js";
import { PREVIEW_SUITE } from "../core/preview.js";
import { MAX_REWRITE_INPUT_CHARACTERS } from "../core/rewrite.js";
import { hasFlag, parseArgs, type ParsedArgs } from "./args.js";
import { CliError } from "./errors.js";
import { harnessCandidates, harnessRewriteCandidate, harnessRewritePrompt, scoreHarnessOutputs } from "./harness.js";
import {
  MAX_CLI_OUTPUTS_JSON_BYTES,
  MAX_CLI_PROMPT_CHARACTERS,
  MAX_CLI_REPLY_BYTES,
  type CliIo,
  loadOptionalSuite,
  loadOptionalText,
  loadOutputsJson,
  loadPrompt,
  loadPromptFromFlags,
  loadReplyText,
  writeStream,
} from "./io.js";
import {
  formatCandidatesJson,
  formatCandidatesText,
  formatRewriteCandidateJson,
  formatRewriteCandidateText,
  formatRewritePromptJson,
  formatRewritePromptText,
  formatScoreJson,
  formatScoreText,
} from "./output.js";

/**
 * Model-free entry for `candidates`, `score`, `rewrite-prompt`, and `rewrite-candidate`. It must not import Pi,
 * completion adapters with runtime dependencies, or any npm package: the skill tool bundle under
 * skills/prompt-optimize/scripts is built from it.
 */

const HARNESS_COMMANDS = new Set(["candidates", "score", "rewrite-prompt", "rewrite-candidate"]);

export interface RunHarnessCliOptions {
  readonly argv?: readonly string[];
  readonly io?: CliIo;
}

export const CANDIDATES_HELP = `Usage: arc-prompt candidates [--prompt <text>|--prompt-file <file>|stdin] [options]

Print the baseline prompt plus critique, decomposition, and structured reasoning variants.
No model calls, credentials, or network access. Candidate ids are stable for a given prompt.

Options:
  --prompt <text>           Prompt input as an argument.
  --prompt-file <file>      Prompt input from a file.
  --json                    Emit canonical JSON: {"candidates":[{"id","pattern","prompt"}]}.
  Prompt input limit: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.
  -h, --help                Show help.
`;

export const SCORE_HELP = `Usage: arc-prompt score [--suite <file.json>] [--outputs <file.json>|stdin] [options]

Score candidate outputs produced by any agent harness with deterministic checks, then rank them.
No model calls, credentials, network access, or semantic judge.

Outputs JSON (unknown keys are rejected):
  {"candidates":[{"id":"<candidateId>","prompt":"<optional text>",
    "outputs":{"<caseId>":"<output text>"},
    "measurements":{"<caseId>":{"latencyMs":0,"inputTokens":0,"outputTokens":0,"costUsd":0}}}]}
  Every suite case needs an output for every candidate. Measurements are optional; missing ones are
  reported as unknown and only break exact quality ties.
  Without --suite, the preview suite '${PREVIEW_SUITE.id}' is used; its single case id is
  '${PREVIEW_SUITE.cases[0]!.id}' (passes when the output is non-empty).

Options:
  --suite <file.json>       Evaluation suite JSON (default: preview suite).
  --outputs <file.json>     Outputs JSON from a file (otherwise read from stdin).
  --json                    Emit canonical JSON with ranking and per-case checks.
  Limits: ${MAX_EVALUATION_CANDIDATES} candidates, ${MAX_COMPLETION_OUTPUT_CHARACTERS} characters per output, ${MAX_CLI_OUTPUTS_JSON_BYTES} bytes of outputs JSON.
  -h, --help                Show help.
`;

export const REWRITE_PROMPT_HELP = `Usage: arc-prompt rewrite-prompt [--prompt <text>|--prompt-file <file>|stdin] [options]

Print the meta-prompt that asks a model to analyze a draft prompt and rewrite it with a specific role, an
explicit output format, constraints, and examples. Answer it with the harness's own model, then turn the
reply into a candidate with 'rewrite-candidate'. No model calls, credentials, or network access.

Options:
  --prompt <text>           Draft prompt as an argument.
  --prompt-file <file>      Draft prompt from a file.
  --context <text>          Optional task context: where the prompt runs and what it works on.
  --context-file <file>     Task context from a file.
  --use-case <text>         Optional target use case: what the output is for and who reads it.
  --use-case-file <file>    Target use case from a file.
  --json                    Emit canonical JSON: {"prompt":"<meta-prompt>"}.
  Limits: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters of draft, ${MAX_REWRITE_INPUT_CHARACTERS} of context and of use case.
  -h, --help                Show help.
`;

export const REWRITE_CANDIDATE_HELP = `Usage: arc-prompt rewrite-candidate --prompt <text>|--prompt-file <file> [--reply <file>|stdin] [options]

Parse a model's reply to the 'rewrite-prompt' meta-prompt into a rewrite candidate whose id 'score' accepts
next to the 'candidates' output. The reply must hold complete <analysis>, <rewritten_prompt>, and <changes>
sections; a missing or empty <rewritten_prompt> fails with INVALID_REWRITE_REPLY instead of guessing.

Options:
  --prompt <text>           The original draft prompt as an argument (never read from stdin here).
  --prompt-file <file>      The original draft prompt from a file.
  --reply <file>            The model's reply from a file (otherwise read from stdin).
  --json                    Emit canonical JSON: {"candidate":{"id","pattern","prompt"},"analysis":[],"changes":[]}.
  Limits: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters of draft, ${MAX_CLI_REPLY_BYTES} bytes of reply.
  -h, --help                Show help.
`;

const HARNESS_TOOLS_HELP = `Usage: arc-prompt-tools <command> [options]

Model-free prompt optimization tools for any agent harness (no model calls, credentials, or network access).

Commands:
  candidates        Print the baseline and pattern prompt candidates.
  rewrite-prompt    Print the meta-prompt that asks a model to rewrite the draft.
  rewrite-candidate Parse the model's rewrite reply into a candidate for 'score'.
  score             Score harness-produced candidate outputs deterministically.

Run 'arc-prompt-tools <command> --help' for command-specific options.
`;

const HARNESS_HELP: Readonly<Record<string, string>> = Object.freeze({
  candidates: CANDIDATES_HELP,
  score: SCORE_HELP,
  "rewrite-prompt": REWRITE_PROMPT_HELP,
  "rewrite-candidate": REWRITE_CANDIDATE_HELP,
});

export function defaultCliIo(): CliIo {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  };
}

export async function commandCandidates(args: ParsedArgs, io: CliIo): Promise<number> {
  const prompt = await loadPrompt(args, io);
  const candidates = harnessCandidates(prompt);
  await writeStream(io.stdout, hasFlag(args, "json") ? formatCandidatesJson(candidates) : formatCandidatesText(candidates));
  return 0;
}

export async function commandScore(args: ParsedArgs, io: CliIo): Promise<number> {
  const suite = await loadOptionalSuite(args, io, PREVIEW_SUITE);
  const outputs = await loadOutputsJson(args, io);
  const result = scoreHarnessOutputs(suite, outputs);
  await writeStream(io.stdout, hasFlag(args, "json") ? formatScoreJson(result) : formatScoreText(result));
  return 0;
}

export async function commandRewritePrompt(args: ParsedArgs, io: CliIo): Promise<number> {
  const prompt = await loadPrompt(args, io);
  const context = await loadOptionalText(args, io, "context");
  const useCase = await loadOptionalText(args, io, "use-case");
  const metaPrompt = harnessRewritePrompt(prompt, {
    ...(context === undefined ? {} : { context }),
    ...(useCase === undefined ? {} : { useCase }),
  });
  await writeStream(io.stdout, hasFlag(args, "json") ? formatRewritePromptJson(metaPrompt) : formatRewritePromptText(metaPrompt));
  return 0;
}

export async function commandRewriteCandidate(args: ParsedArgs, io: CliIo): Promise<number> {
  const prompt = await loadPromptFromFlags(args, io);
  const reply = await loadReplyText(args, io);
  const parsed = harnessRewriteCandidate(prompt, reply);
  if (parsed.status === "invalid") throw new CliError("INVALID_REWRITE_REPLY", `${parsed.reason}.`);
  await writeStream(io.stdout, hasFlag(args, "json") ? formatRewriteCandidateJson(parsed.value) : formatRewriteCandidateText(parsed.value));
  return 0;
}

/** Maps errors to the shared CLI exit codes: 2 for usage/validation errors, 1 otherwise. */
export async function reportCliError(error: unknown, io: CliIo): Promise<number> {
  if (error instanceof CliError || error instanceof CoreValidationError) {
    await writeStream(io.stderr, `${error.code}: ${error.message}\n`);
    return 2;
  }
  if (error instanceof Error) {
    await writeStream(io.stderr, `${error.name}: ${error.message}\n`);
    return 1;
  }
  await writeStream(io.stderr, "Unknown error.\n");
  return 1;
}

/** Runs the model-free commands only, with the same flags and output as `arc-prompt`. */
export async function runHarnessCli(options: RunHarnessCliOptions = {}): Promise<number> {
  const io = options.io ?? defaultCliIo();
  try {
    const argv = options.argv ?? process.argv.slice(2);
    const [command] = argv;
    if (command === undefined || ((command === "--help" || command === "-h") && argv.length === 1)) {
      await writeStream(command === undefined ? io.stderr : io.stdout, HARNESS_TOOLS_HELP);
      return command === undefined ? 2 : 0;
    }
    if (!HARNESS_COMMANDS.has(command)) {
      throw new CliError(
        "INVALID_ARGUMENT",
        `Unknown command '${command}'. Supported commands: candidates, score, rewrite-prompt, rewrite-candidate.`,
      );
    }
    const args = parseArgs(argv);
    if (hasFlag(args, "help")) {
      await writeStream(io.stdout, HARNESS_HELP[command]!);
      return 0;
    }
    switch (command) {
      case "candidates":
        return await commandCandidates(args, io);
      case "score":
        return await commandScore(args, io);
      case "rewrite-prompt":
        return await commandRewritePrompt(args, io);
      default:
        return await commandRewriteCandidate(args, io);
    }
  } catch (error) {
    return await reportCliError(error, io);
  }
}
