import { CliError } from "./errors.js";

export const MAX_CLI_JSON_CHARACTERS = 8 * 1024 * 1024;
const MAX_CLI_JSON_DEPTH = 64;

type SerializationState = {
  readonly output: string[];
  characters: number;
};

function jsonError(path: string, reason: string): never {
  throw new CliError("INVALID_JSON_OUTPUT", `Cannot serialize CLI JSON at ${path}: ${reason}.`);
}

function sizeOverflow(path: string, size: number): never {
  throw new CliError(
    "OUTPUT_TOO_LARGE",
    `CLI JSON output would be ${size} UTF-16 characters; limit is ${MAX_CLI_JSON_CHARACTERS}.`,
  );
}

function append(state: SerializationState, text: string, path: string): void {
  const nextSize = state.characters + text.length;
  if (nextSize > MAX_CLI_JSON_CHARACTERS) sizeOverflow(path, nextSize);
  state.output.push(text);
  state.characters = nextSize;
}

function appendJsonString(state: SerializationState, value: string, path: string): void {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") jsonError(path, "string encoding failed");
  append(state, encoded, path);
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z][A-Za-z0-9_]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function serialize(value: unknown, path: string, depth: number, ancestors: Set<object>, state: SerializationState): void {
  if (depth > MAX_CLI_JSON_DEPTH) jsonError(path, `nesting depth ${depth} exceeds limit of ${MAX_CLI_JSON_DEPTH}`);

  if (value === null) {
    append(state, "null", path);
    return;
  }
  if (typeof value === "string") {
    appendJsonString(state, value, path);
    return;
  }
  if (typeof value === "boolean") {
    append(state, value ? "true" : "false", path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) jsonError(path, "numbers must be finite");
    append(state, Object.is(value, -0) ? "0" : JSON.stringify(value), path);
    return;
  }
  if (typeof value !== "object") jsonError(path, `unsupported type '${typeof value}'`);
  if (ancestors.has(value)) jsonError(path, "circular references are not supported");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const names = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
      for (const key of names) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
          jsonError(path, `non-index array property '${key}' is not supported`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          jsonError(`${path}[${index}]`, "only enumerable data properties are supported");
        }
      }
      append(state, "[", path);
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) append(state, ",", path);
        if (!Object.hasOwn(value, index)) jsonError(`${path}[${index}]`, "sparse arrays are not supported");
        serialize(value[index], `${path}[${index}]`, depth + 1, ancestors, state);
      }
      append(state, "]", path);
      return;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      jsonError(path, "only plain objects and arrays are supported");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) jsonError(path, "symbol-keyed properties are not supported");

    const keys = Object.getOwnPropertyNames(value).sort();
    append(state, "{", path);
    for (const [index, key] of keys.entries()) {
      if (index > 0) append(state, ",", path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const childPath = propertyPath(path, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        jsonError(childPath, "only enumerable data properties are supported");
      }
      appendJsonString(state, key, childPath);
      append(state, ":", childPath);
      serialize(descriptor.value, childPath, depth + 1, ancestors, state);
    }
    append(state, "}", path);
  } finally {
    ancestors.delete(value);
  }
}

export function stringifyCliJson(value: unknown): string {
  const state: SerializationState = { output: [], characters: 0 };
  serialize(value, "$", 0, new Set(), state);
  return state.output.join("");
}

export function stringifyCliJsonLine(value: unknown): string {
  const json = stringifyCliJson(value);
  const sizeWithNewline = json.length + 1;
  if (sizeWithNewline > MAX_CLI_JSON_CHARACTERS) sizeOverflow("$", sizeWithNewline);
  return `${json}\n`;
}
