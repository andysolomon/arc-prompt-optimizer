import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEvaluationSuite } from "../core/evaluation.mjs";
import { flagValues, singleFlag } from "./args.mjs";
import { CliError } from "./errors.mjs";
import { stringifyCliJsonLine } from "./json.mjs";
export const MAX_CLI_PROMPT_CHARACTERS = 16_384;
const PROMPT_READ_CHUNK_BYTES = 4_096;
export const MAX_CLI_SUITE_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_CLI_OUTPUTS_JSON_BYTES = 8 * 1024 * 1024;
export async function writeStream(stream, text) {
    await new Promise((resolvePromise, reject) => {
        stream.write(text, (error) => {
            if (error)
                reject(error);
            else
                resolvePromise();
        });
    });
}
function promptTooLargeError() {
    return new CliError("INPUT_TOO_LARGE", `Prompt input exceeds ${MAX_CLI_PROMPT_CHARACTERS} UTF-16 characters.`);
}
function appendBoundedPromptText(current, chunk) {
    const allowedCharacters = MAX_CLI_PROMPT_CHARACTERS + 1 - current.length;
    if (allowedCharacters <= 0)
        return { text: current, tooLarge: true };
    const text = current + chunk.slice(0, allowedCharacters);
    return { text, tooLarge: text.length > MAX_CLI_PROMPT_CHARACTERS };
}
async function readBoundedPromptStream(stream) {
    return await new Promise((resolvePromise, reject) => {
        let text = "";
        let settled = false;
        const rejectOnce = (error) => {
            if (settled)
                return;
            settled = true;
            stream.destroy?.(error);
            reject(error);
        };
        stream.on("data", (chunk) => {
            if (settled)
                return;
            const next = appendBoundedPromptText(text, chunk);
            text = next.text;
            if (next.tooLarge)
                rejectOnce(promptTooLargeError());
        });
        stream.on("end", () => {
            if (settled)
                return;
            settled = true;
            resolvePromise(text);
        });
        stream.on("error", rejectOnce);
    });
}
export async function readStdin(stdin) {
    if (stdin.isTTY === true)
        return "";
    stdin.setEncoding("utf8");
    return await readBoundedPromptStream(stdin);
}
export async function readPromptFile(path) {
    const stream = createReadStream(path, { encoding: "utf8", highWaterMark: PROMPT_READ_CHUNK_BYTES });
    return await readBoundedPromptStream(stream);
}
function suiteTooLargeError(path) {
    return new CliError("INPUT_TOO_LARGE", `Suite file '${path}' exceeds ${MAX_CLI_SUITE_JSON_BYTES} bytes.`);
}
function readBoundedUtf8Stream(stream, maxBytes, tooLarge) {
    return new Promise((resolvePromise, reject) => {
        let text = "";
        let bytes = 0;
        let settled = false;
        const rejectOnce = (error) => {
            if (settled)
                return;
            settled = true;
            stream.destroy?.(error);
            reject(error);
        };
        stream.on("data", (chunk) => {
            if (settled)
                return;
            bytes += Buffer.byteLength(chunk, "utf8");
            if (bytes > maxBytes) {
                rejectOnce(tooLarge());
                return;
            }
            text += chunk;
        });
        stream.on("end", () => {
            if (settled)
                return;
            settled = true;
            resolvePromise(text);
        });
        stream.on("error", rejectOnce);
    });
}
async function readBoundedUtf8File(path, displayPath, maxBytes) {
    const stream = createReadStream(path, { encoding: "utf8", highWaterMark: PROMPT_READ_CHUNK_BYTES });
    return await readBoundedUtf8Stream(stream, maxBytes, () => suiteTooLargeError(displayPath));
}
export async function loadPrompt(args, io) {
    const promptValues = flagValues(args, "prompt");
    const fileValues = flagValues(args, "prompt-file");
    if (promptValues.length > 1)
        throw new CliError("INVALID_ARGUMENT", "Flag --prompt may be provided at most once.");
    if (fileValues.length > 1)
        throw new CliError("INVALID_ARGUMENT", "Flag --prompt-file may be provided at most once.");
    const explicitSources = Number(promptValues.length === 1) + Number(fileValues.length === 1);
    const stdinText = await readStdin(io.stdin);
    const hasStdin = stdinText.trim() !== "";
    if (explicitSources + Number(hasStdin) > 1) {
        throw new CliError("AMBIGUOUS_INPUT", "Provide prompt input from exactly one source: --prompt, --prompt-file, or stdin.");
    }
    let prompt;
    if (promptValues[0] !== undefined)
        prompt = promptValues[0];
    else if (fileValues[0] !== undefined)
        prompt = await readPromptFile(resolve(io.cwd, fileValues[0]));
    else if (hasStdin)
        prompt = stdinText;
    else
        throw new CliError("MISSING_INPUT", "Provide prompt input from --prompt, --prompt-file, or stdin.");
    if (prompt.trim() === "")
        throw new CliError("MISSING_INPUT", "Prompt input cannot be empty.");
    if (prompt.length > MAX_CLI_PROMPT_CHARACTERS) {
        throw new CliError("INPUT_TOO_LARGE", `Prompt input is ${prompt.length} UTF-16 characters; limit is ${MAX_CLI_PROMPT_CHARACTERS}.`);
    }
    return prompt;
}
export async function loadSuite(args, io) {
    const path = singleFlag(args, "suite");
    if (path === undefined)
        throw new CliError("MISSING_ARGUMENT", "Flag --suite <file.json> is required.");
    let parsed;
    try {
        parsed = JSON.parse(await readBoundedUtf8File(resolve(io.cwd, path), path, MAX_CLI_SUITE_JSON_BYTES));
    }
    catch (error) {
        if (error instanceof SyntaxError)
            throw new CliError("INVALID_JSON", `Suite file '${path}' is not valid JSON.`);
        throw error;
    }
    const suite = validateEvaluationSuite(parsed);
    if (suite.cases.length === 0)
        throw new CliError("INVALID_ARGUMENT", `Suite '${suite.id}' must include at least one case.`);
    return suite;
}
/** Loads the suite from --suite when present; otherwise returns the fallback suite. */
export async function loadOptionalSuite(args, io, fallback) {
    if (singleFlag(args, "suite") === undefined)
        return fallback;
    return await loadSuite(args, io);
}
/** Reads harness-produced outputs JSON from exactly one source: --outputs <file> or stdin. */
export async function loadOutputsJson(args, io) {
    const path = singleFlag(args, "outputs");
    let stdinText = "";
    if (io.stdin.isTTY !== true) {
        io.stdin.setEncoding("utf8");
        stdinText = await readBoundedUtf8Stream(io.stdin, MAX_CLI_OUTPUTS_JSON_BYTES, () => new CliError("INPUT_TOO_LARGE", `Outputs input on stdin exceeds ${MAX_CLI_OUTPUTS_JSON_BYTES} bytes.`));
    }
    const hasStdin = stdinText.trim() !== "";
    if (path !== undefined && hasStdin) {
        throw new CliError("AMBIGUOUS_INPUT", "Provide outputs JSON from exactly one source: --outputs or stdin.");
    }
    let text;
    let label;
    if (path !== undefined) {
        const stream = createReadStream(resolve(io.cwd, path), { encoding: "utf8", highWaterMark: PROMPT_READ_CHUNK_BYTES });
        text = await readBoundedUtf8Stream(stream, MAX_CLI_OUTPUTS_JSON_BYTES, () => new CliError("INPUT_TOO_LARGE", `Outputs file '${path}' exceeds ${MAX_CLI_OUTPUTS_JSON_BYTES} bytes.`));
        label = `Outputs file '${path}'`;
    }
    else if (hasStdin) {
        text = stdinText;
        label = "Outputs input on stdin";
    }
    else {
        throw new CliError("MISSING_INPUT", "Provide outputs JSON from --outputs <file.json> or stdin.");
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
        if (error instanceof SyntaxError)
            throw new CliError("INVALID_JSON", `${label} is not valid JSON.`);
        throw error;
    }
}
export function validateOutputFlag(args) {
    const values = flagValues(args, "output");
    if (values.length > 1)
        throw new CliError("INVALID_ARGUMENT", "Flag --output may be provided at most once.");
}
export async function writeJsonOutput(args, io, value) {
    const output = singleFlag(args, "output");
    if (output === undefined)
        return undefined;
    const path = resolve(io.cwd, output);
    const json = stringifyCliJsonLine(value);
    await writeFile(path, json, "utf8");
    return path;
}
