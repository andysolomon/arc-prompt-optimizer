import { CoreValidationError } from "./errors.js";
import { MAX_ARRAY_ENTRIES, ownPropertyNames } from "./validation.js";

export const MAX_CANONICAL_DEPTH = 64;
export const MAX_CANONICAL_SERIALIZED_CHARACTERS = 48_000;

type SerializationState = {
  readonly output: string[];
  characters: number;
};

function unsupported(path: string, reason: string): never {
  throw new CoreValidationError(
    "NON_CANONICAL_VALUE",
    `Cannot canonically serialize value at ${path}: ${reason}.`,
  );
}

function depthOverflow(path: string, depth: number): never {
  return unsupported(
    path,
    `nesting depth ${depth} exceeds limit of ${MAX_CANONICAL_DEPTH}`,
  );
}

function sizeOverflow(path: string, size: number): never {
  return unsupported(
    path,
    `serialized output would be ${size} characters; limit is ${MAX_CANONICAL_SERIALIZED_CHARACTERS}`,
  );
}

function append(state: SerializationState, text: string, path: string): void {
  const nextSize = state.characters + text.length;
  if (nextSize > MAX_CANONICAL_SERIALIZED_CHARACTERS) sizeOverflow(path, nextSize);
  state.output.push(text);
  state.characters = nextSize;
}

function appendJsonString(state: SerializationState, value: string, path: string): void {
  append(state, '"', path);
  for (const character of value) {
    const encoded = JSON.stringify(character);
    if (typeof encoded !== "string") unsupported(path, "string encoding failed");
    append(state, encoded.slice(1, -1), path);
  }
  append(state, '"', path);
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z][A-Za-z0-9_]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function ownDataPropertyNames(value: object, path: string, isArray = false): string[] {
  const names: string[] = [];
  for (const key of ownPropertyNames(
    value,
    "NON_CANONICAL_VALUE",
    `Canonical value at ${path}`,
    isArray,
  )) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const childPath = propertyPath(path, key);
    if (!descriptor || !("value" in descriptor)) {
      unsupported(childPath, "accessor properties are not supported");
    }
    if (!descriptor.enumerable) {
      unsupported(childPath, "non-enumerable properties are not supported");
    }
    names.push(key);
  }
  return names;
}

function serialize(
  value: unknown,
  path: string,
  depth: number,
  ancestors: Set<object>,
  state: SerializationState,
): void {
  if (depth > MAX_CANONICAL_DEPTH) depthOverflow(path, depth);

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
    if (!Number.isFinite(value)) unsupported(path, "numbers must be finite");
    append(state, Object.is(value, -0) ? "0" : JSON.stringify(value), path);
    return;
  }
  if (typeof value !== "object") unsupported(path, `unsupported type '${typeof value}'`);
  if (ancestors.has(value)) unsupported(path, "circular reference");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        unsupported(path, "symbol-keyed array properties are not supported");
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        unsupported(path, "array length must be a data property");
      }
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_ENTRIES) {
        unsupported(path, `array length ${String(length)} exceeds limit of ${MAX_ARRAY_ENTRIES}`);
      }
      const keys = ownDataPropertyNames(value, path, true);
      const indexKeys = keys.filter((key) => {
        const index = Number(key);
        return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
      });
      if (indexKeys.length !== keys.length) {
        unsupported(path, "non-index array properties are not supported");
      }
      if (indexKeys.length !== length) {
        unsupported(path, "sparse arrays are not supported; use explicit null values");
      }

      append(state, "[", path);
      for (let index = 0; index < length; index += 1) {
        if (index > 0) append(state, ",", path);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          unsupported(`${path}[${index}]`, "accessor properties are not supported");
        }
        serialize(descriptor.value, `${path}[${index}]`, depth + 1, ancestors, state);
      }
      append(state, "]", path);
      return;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      unsupported(path, "only plain objects and arrays are supported");
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      unsupported(path, "symbol-keyed properties are not supported");
    }

    const keys = ownDataPropertyNames(value, path);
    append(state, "{", path);
    for (const [index, key] of keys.entries()) {
      if (index > 0) append(state, ",", path);
      const childPath = propertyPath(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        unsupported(childPath, "accessor properties are not supported");
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

export function canonicalStringify(value: unknown): string {
  const state: SerializationState = { output: [], characters: 0 };
  serialize(value, "$", 0, new Set(), state);
  return state.output.join("");
}
