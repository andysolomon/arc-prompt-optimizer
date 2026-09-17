import { CliError } from "./errors.mjs";
const COMMANDS = new Set(["optimize", "evaluate", "patterns", "models", "candidates", "score"]);
const BOOLEAN_FLAGS = new Set(["json", "simulate", "help"]);
const VALUE_FLAGS = new Set([
    "prompt",
    "prompt-file",
    "suite",
    "model",
    "default-model",
    "concurrency",
    "timeout",
    "timeout-ms",
    "output",
    "outputs",
]);
const OPTIMIZE_FLAGS = [...BOOLEAN_FLAGS, ...VALUE_FLAGS].filter((flag) => flag !== "outputs");
const COMMAND_FLAGS = Object.freeze({
    optimize: new Set(OPTIMIZE_FLAGS),
    evaluate: new Set(OPTIMIZE_FLAGS),
    patterns: new Set(["json", "help"]),
    models: new Set(["json", "simulate", "help"]),
    candidates: new Set(["json", "help", "prompt", "prompt-file"]),
    score: new Set(["json", "help", "suite", "outputs"]),
});
function isCommand(value) {
    return COMMANDS.has(value);
}
function pushFlag(flags, name, value) {
    const entries = flags.get(name) ?? [];
    entries.push(value);
    flags.set(name, entries);
}
export function parseArgs(argv) {
    const [commandValue, ...rest] = argv;
    if (commandValue === undefined || commandValue === "--help" || commandValue === "-h") {
        throw new CliError("MISSING_ARGUMENT", "Usage: arc-prompt <optimize|evaluate|patterns|models|candidates|score> [options]");
    }
    if (!isCommand(commandValue)) {
        throw new CliError("INVALID_ARGUMENT", `Unknown command '${commandValue}'.`);
    }
    const flags = new Map();
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === "-h") {
            pushFlag(flags, "help", "true");
            continue;
        }
        if (!token.startsWith("--")) {
            throw new CliError("INVALID_ARGUMENT", `Unexpected positional argument '${token}'.`);
        }
        const raw = token.slice(2);
        const equalsIndex = raw.indexOf("=");
        const name = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
        const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);
        if (!BOOLEAN_FLAGS.has(name) && !VALUE_FLAGS.has(name))
            throw new CliError("INVALID_ARGUMENT", `Unknown flag --${name}.`);
        if (!COMMAND_FLAGS[commandValue].has(name)) {
            throw new CliError("INVALID_ARGUMENT", `Flag --${name} is not supported by '${commandValue}'.`);
        }
        if (BOOLEAN_FLAGS.has(name)) {
            if (inlineValue !== undefined)
                throw new CliError("INVALID_ARGUMENT", `Flag --${name} does not accept a value.`);
            pushFlag(flags, name, "true");
            continue;
        }
        const value = inlineValue ?? rest[index + 1];
        if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
            throw new CliError("MISSING_ARGUMENT", `Flag --${name} requires a value.`);
        }
        if (inlineValue === undefined)
            index += 1;
        pushFlag(flags, name, value);
    }
    return Object.freeze({ command: commandValue, flags });
}
export function flagValues(args, name) {
    return args.flags.get(name) ?? [];
}
export function hasFlag(args, name) {
    return flagValues(args, name).length > 0;
}
export function singleFlag(args, name) {
    const values = flagValues(args, name);
    if (values.length > 1)
        throw new CliError("INVALID_ARGUMENT", `Flag --${name} may be provided at most once.`);
    return values[0];
}
export function integerFlag(args, name, defaultValue, bounds) {
    const value = singleFlag(args, name);
    if (value === undefined)
        return defaultValue;
    if (!/^\d+$/u.test(value))
        throw new CliError("INVALID_ARGUMENT", `Flag --${name} must be an integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
        throw new CliError("INVALID_ARGUMENT", `Flag --${name} must be between ${bounds.min} and ${bounds.max}.`);
    }
    return parsed;
}
