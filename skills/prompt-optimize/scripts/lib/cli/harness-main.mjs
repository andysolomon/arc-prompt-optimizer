import process from "node:process";
import { MAX_COMPLETION_OUTPUT_CHARACTERS } from "../adapters/completion.mjs";
import { CoreValidationError } from "../core/errors.mjs";
import { MAX_EVALUATION_CANDIDATES } from "../core/evaluation.mjs";
import { PREVIEW_SUITE } from "../core/preview.mjs";
import { hasFlag, parseArgs } from "./args.mjs";
import { CliError } from "./errors.mjs";
import { harnessCandidates, scoreHarnessOutputs } from "./harness.mjs";
import { MAX_CLI_OUTPUTS_JSON_BYTES, MAX_CLI_PROMPT_CHARACTERS, loadOptionalSuite, loadOutputsJson, loadPrompt, writeStream, } from "./io.mjs";
import { formatCandidatesJson, formatCandidatesText, formatScoreJson, formatScoreText } from "./output.mjs";
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
  '${PREVIEW_SUITE.cases[0].id}' (passes when the output is non-empty).

Options:
  --suite <file.json>       Evaluation suite JSON (default: preview suite).
  --outputs <file.json>     Outputs JSON from a file (otherwise read from stdin).
  --json                    Emit canonical JSON with ranking and per-case checks.
  Limits: ${MAX_EVALUATION_CANDIDATES} candidates, ${MAX_COMPLETION_OUTPUT_CHARACTERS} characters per output, ${MAX_CLI_OUTPUTS_JSON_BYTES} bytes of outputs JSON.
  -h, --help                Show help.
`;
const HARNESS_TOOLS_HELP = `Usage: arc-prompt-tools <command> [options]

Model-free prompt optimization tools for any agent harness (no model calls, credentials, or network access).

Commands:
  candidates Print the baseline and pattern prompt candidates.
  score      Score harness-produced candidate outputs deterministically.

Run 'arc-prompt-tools <command> --help' for command-specific options.
`;
export function defaultCliIo() {
    return {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        cwd: process.cwd(),
    };
}
export async function commandCandidates(args, io) {
    const prompt = await loadPrompt(args, io);
    const candidates = harnessCandidates(prompt);
    await writeStream(io.stdout, hasFlag(args, "json") ? formatCandidatesJson(candidates) : formatCandidatesText(candidates));
    return 0;
}
export async function commandScore(args, io) {
    const suite = await loadOptionalSuite(args, io, PREVIEW_SUITE);
    const outputs = await loadOutputsJson(args, io);
    const result = scoreHarnessOutputs(suite, outputs);
    await writeStream(io.stdout, hasFlag(args, "json") ? formatScoreJson(result) : formatScoreText(result));
    return 0;
}
/** Maps errors to the shared CLI exit codes: 2 for usage/validation errors, 1 otherwise. */
export async function reportCliError(error, io) {
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
/** Runs only `candidates` and `score`, with the same flags and output as `arc-prompt`. */
export async function runHarnessCli(options = {}) {
    const io = options.io ?? defaultCliIo();
    try {
        const argv = options.argv ?? process.argv.slice(2);
        const [command] = argv;
        if (command === undefined || ((command === "--help" || command === "-h") && argv.length === 1)) {
            await writeStream(command === undefined ? io.stderr : io.stdout, HARNESS_TOOLS_HELP);
            return command === undefined ? 2 : 0;
        }
        if (command !== "candidates" && command !== "score") {
            throw new CliError("INVALID_ARGUMENT", `Unknown command '${command}'. Supported commands: candidates, score.`);
        }
        const args = parseArgs(argv);
        if (hasFlag(args, "help")) {
            await writeStream(io.stdout, command === "candidates" ? CANDIDATES_HELP : SCORE_HELP);
            return 0;
        }
        return command === "candidates" ? await commandCandidates(args, io) : await commandScore(args, io);
    }
    catch (error) {
        return await reportCliError(error, io);
    }
}
