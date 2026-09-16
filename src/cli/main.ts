import process from "node:process";
import {
  DEFAULT_RANKING_OBJECTIVE,
  MAX_COMPLETION_MODEL_CHARACTERS,
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_COMPLETION_TIMEOUT_MS,
  PROMPT_PATTERNS,
  defaultPatternCatalog,
  fingerprint,
  generateCandidates,
  rankCandidates,
  validateRankingObjective,
} from "../core/index.js";
import { CoreValidationError } from "../core/errors.js";
import type { CandidateSpec, OptimizationResult, PromptCandidate } from "../core/index.js";
import { hasFlag, integerFlag, parseArgs, singleFlag, type ParsedArgs } from "./args.js";
import { listDefaultPiModels, selectAdapter } from "./adapters.js";
import { CliError } from "./errors.js";
import { evaluateCandidatesBounded } from "./evaluate.js";
import { MAX_CLI_PROMPT_CHARACTERS, type CliIo, loadPrompt, loadSuite, validateOutputFlag, writeJsonOutput, writeStream } from "./io.js";
import {
  formatEvaluationText,
  formatJson,
  formatModelsText,
  formatOptimizationText,
  formatPatternsJson,
  formatPatternsText,
  fullEvaluationForOutput,
  fullOptimizationForOutput,
  redactOptimization,
  redactSuiteEvaluation,
} from "./output.js";
import { SIMULATED_MODELS } from "./simulated-adapter.js";

export interface RunCliOptions {
  readonly argv?: readonly string[];
  readonly io?: CliIo;
}

const MAX_CLI_CONCURRENCY = 16;
const DEFAULT_CLI_CONCURRENCY = 4;

const TOP_LEVEL_HELP = `Usage: arc-prompt <command> [options]

Commands:
  optimize   Generate and rank prompt variants against a suite.
  evaluate   Evaluate one prompt against a suite.
  patterns   List the offline prompt pattern catalog.
  models     List available models.

Common options:
  --json                    Emit canonical JSON.
  -h, --help                Show help.

Optimize/evaluate options:
  --simulate                Use the credential-free simulated adapter.
  --model <name>            Select a model for this request.
  --default-model <name>    Set the adapter fallback model.
  --concurrency <1..16>     Bound concurrent completions.
  --timeout <ms>            Completion timeout in milliseconds.
  --timeout-ms <ms>         Compatibility alias for --timeout.
  Prompt input limit: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.

Models options:
  --simulate                Use the credential-free simulated catalog.

Run 'arc-prompt <command> --help' for command-specific options.
`;

const COMMAND_HELP: Readonly<Record<ParsedArgs["command"], string>> = {
  optimize: `Usage: arc-prompt optimize --suite <file.json> [--prompt <text>|--prompt-file <file>|stdin] [options]

Generate critique, decomposition, and structured reasoning prompt variants, evaluate them, and print a ranked result.

Options:
  --suite <file.json>       Evaluation suite JSON.
  --prompt <text>           Prompt input as an argument.
  --prompt-file <file>      Prompt input from a file.
  --output <file>           Write full JSON, including prompt text, to a file.
  --json                    Emit canonical redacted JSON to stdout.
  --simulate                Use the credential-free simulated adapter.
  --model <name>            Select a model for this request.
  --default-model <name>    Set the adapter fallback model.
  --concurrency <1..16>     Bound concurrent completions.
  --timeout <ms>            Completion timeout in milliseconds.
  --timeout-ms <ms>         Compatibility alias for --timeout.
  Prompt input limit: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.
  -h, --help                Show help.
`,
  evaluate: `Usage: arc-prompt evaluate --suite <file.json> [--prompt <text>|--prompt-file <file>|stdin] [options]

Evaluate one prompt against a suite.

Options:
  --suite <file.json>       Evaluation suite JSON.
  --prompt <text>           Prompt input as an argument.
  --prompt-file <file>      Prompt input from a file.
  --output <file>           Write full JSON, including prompt text, to a file.
  --json                    Emit canonical redacted JSON to stdout.
  --simulate                Use the credential-free simulated adapter.
  --model <name>            Select a model for this request.
  --default-model <name>    Set the adapter fallback model.
  --concurrency <1..16>     Bound concurrent completions.
  --timeout <ms>            Completion timeout in milliseconds.
  --timeout-ms <ms>         Compatibility alias for --timeout.
  Prompt input limit: ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.
  -h, --help                Show help.
`,
  patterns: `Usage: arc-prompt patterns [options]

List the offline prompt pattern catalog without credentials or network access.

Options:
  --json                    Emit canonical JSON.
  -h, --help                Show help.
`,
  models: `Usage: arc-prompt models [options]

List available models. Use --simulate for the credential-free simulated catalog.

Options:
  --json                    Emit canonical JSON.
  --simulate                Use the credential-free simulated catalog.
  -h, --help                Show help.
`,
};

function defaultIo(): CliIo {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  };
}

function validateModelFlag(name: "model" | "default-model", value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") throw new CliError("INVALID_ARGUMENT", `Flag --${name} must be a non-empty string.`);
  if (value.length > MAX_COMPLETION_MODEL_CHARACTERS) {
    throw new CliError(
      "INPUT_TOO_LARGE",
      `Flag --${name} is ${value.length} characters; limit is ${MAX_COMPLETION_MODEL_CHARACTERS}.`,
    );
  }
  return value;
}

function modelOption(args: ParsedArgs): { readonly requestModel: string | undefined; readonly defaultModel: string | undefined } {
  const model = singleFlag(args, "model");
  const defaultModel = singleFlag(args, "default-model");
  if (model !== undefined && defaultModel !== undefined) {
    throw new CliError("INVALID_ARGUMENT", "Use --model for per-request selection or --default-model for adapter fallback, not both.");
  }
  const checkedModel = validateModelFlag("model", model);
  const checkedDefaultModel = validateModelFlag("default-model", defaultModel);
  return Object.freeze({ requestModel: checkedModel ?? checkedDefaultModel, defaultModel: checkedDefaultModel });
}

function maxOutputCharacters(): number {
  return MAX_COMPLETION_OUTPUT_CHARACTERS;
}

function isTopLevelHelp(argv: readonly string[]): boolean {
  return argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h");
}

function evaluateCandidateFromPrompt(prompt: string): PromptCandidate {
  return Object.freeze({
    id: `input-${fingerprint({ prompt })}`,
    prompt: Object.freeze({ pattern: "cli_input", text: prompt, variablesUsed: Object.freeze([]) }),
    origin: "fixture",
  });
}

function optimizeSpecs(prompt: string): readonly CandidateSpec[] {
  return Object.freeze([
    Object.freeze({ pattern: "critique", variables: Object.freeze({ task: prompt }), label: "critique" }),
    Object.freeze({ pattern: "decomposition", variables: Object.freeze({ problem: prompt }), label: "decomposition" }),
    Object.freeze({ pattern: "chain_of_thought", variables: Object.freeze({ problem: prompt }), label: "structured_reasoning" }),
  ]);
}

function timeoutFlag(args: ParsedArgs): number {
  const timeout = singleFlag(args, "timeout");
  const timeoutMs = singleFlag(args, "timeout-ms");
  if (timeout !== undefined && timeoutMs !== undefined) {
    throw new CliError("INVALID_ARGUMENT", "Use --timeout or --timeout-ms, not both.");
  }
  const aliasArgs =
    timeout === undefined
      ? args
      : Object.freeze({
          command: args.command,
          flags: new Map([...args.flags, ["timeout-ms", [timeout]]]),
        });
  return integerFlag(aliasArgs, "timeout-ms", 30_000, { min: 0, max: MAX_COMPLETION_TIMEOUT_MS });
}

function cliOptions(args: ParsedArgs): {
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly model: string | undefined;
  readonly defaultModel: string | undefined;
} {
  const model = modelOption(args);
  return {
    concurrency: integerFlag(args, "concurrency", DEFAULT_CLI_CONCURRENCY, { min: 1, max: MAX_CLI_CONCURRENCY }),
    timeoutMs: timeoutFlag(args),
    model: model.requestModel,
    defaultModel: model.defaultModel,
  };
}

function preflightCliCommand(args: ParsedArgs): void {
  if (args.command === "evaluate" || args.command === "optimize") validateOutputFlag(args);
}

async function commandPatterns(args: ParsedArgs, io: CliIo): Promise<number> {
  const text = hasFlag(args, "json") ? formatPatternsJson(PROMPT_PATTERNS) : formatPatternsText(PROMPT_PATTERNS);
  await writeStream(io.stdout, text);
  return 0;
}

async function commandModels(args: ParsedArgs, io: CliIo): Promise<number> {
  if (hasFlag(args, "simulate")) {
    const payload = { models: SIMULATED_MODELS };
    await writeStream(io.stdout, hasFlag(args, "json") ? formatJson(payload) : formatModelsText(SIMULATED_MODELS));
    return 0;
  }
  const models = await listDefaultPiModels(io.cwd);
  const payload = { models };
  await writeStream(io.stdout, hasFlag(args, "json") ? formatJson(payload) : formatModelsText(models));
  return 0;
}

async function commandEvaluate(args: ParsedArgs, io: CliIo): Promise<number> {
  const options = cliOptions(args);
  const prompt = await loadPrompt(args, io);
  const suite = await loadSuite(args, io);
  const { adapter } = await selectAdapter(args, io.cwd, options.defaultModel);
  const candidate = evaluateCandidateFromPrompt(prompt);
  const result = await evaluateCandidatesBounded(
    adapter,
    [candidate],
    suite,
    {
      ...(options.model === undefined ? {} : { model: options.model }),
      maxOutputCharacters: maxOutputCharacters(),
      timeoutMs: options.timeoutMs,
    },
    options.concurrency,
  );
  const outputPath = await writeJsonOutput(args, io, fullEvaluationForOutput({ prompt }, result));
  const payload = outputPath === undefined ? redactSuiteEvaluation(result) : { ...redactSuiteEvaluation(result), output: outputPath };
  await writeStream(io.stdout, hasFlag(args, "json") ? formatJson(payload) : formatEvaluationText(result, outputPath));
  return 0;
}

async function commandOptimize(args: ParsedArgs, io: CliIo): Promise<number> {
  const options = cliOptions(args);
  const prompt = await loadPrompt(args, io);
  const suite = await loadSuite(args, io);
  const { adapter } = await selectAdapter(args, io.cwd, options.defaultModel);
  const generated = generateCandidates({
    specs: optimizeSpecs(prompt),
    catalog: defaultPatternCatalog,
    budget: { maxCandidates: 3, maxCases: suite.cases.length, maxCompletions: 3 * suite.cases.length },
  });
  const evaluation = await evaluateCandidatesBounded(
    adapter,
    generated.candidates,
    suite,
    {
      ...(options.model === undefined ? {} : { model: options.model }),
      maxOutputCharacters: maxOutputCharacters(),
      timeoutMs: options.timeoutMs,
    },
    options.concurrency,
  );
  const objective = validateRankingObjective(DEFAULT_RANKING_OBJECTIVE);
  const result: OptimizationResult = Object.freeze({
    candidates: generated.candidates,
    provenance: generated.provenance,
    evaluations: evaluation.candidates,
    ranking: rankCandidates(evaluation.candidates, objective),
    objective,
    budget: generated.budget,
    completionsUsed: evaluation.completionsUsed,
  });
  const outputPath = await writeJsonOutput(args, io, fullOptimizationForOutput(result));
  const payload = outputPath === undefined ? redactOptimization(result) : { ...redactOptimization(result), output: outputPath };
  await writeStream(io.stdout, hasFlag(args, "json") ? formatJson(payload) : formatOptimizationText(result, outputPath));
  return 0;
}

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? defaultIo();
  try {
    const argv = options.argv ?? process.argv.slice(2);
    if (isTopLevelHelp(argv)) {
      await writeStream(io.stdout, TOP_LEVEL_HELP);
      return 0;
    }
    const args = parseArgs(argv);
    if (hasFlag(args, "help")) {
      await writeStream(io.stdout, COMMAND_HELP[args.command]);
      return 0;
    }
    preflightCliCommand(args);
    switch (args.command) {
      case "patterns":
        return await commandPatterns(args, io);
      case "models":
        return await commandModels(args, io);
      case "evaluate":
        return await commandEvaluate(args, io);
      case "optimize":
        return await commandOptimize(args, io);
    }
  } catch (error) {
    if (error instanceof CliError) {
      await writeStream(io.stderr, `${error.code}: ${error.message}\n`);
      return 2;
    }
    if (error instanceof CoreValidationError) {
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
}
