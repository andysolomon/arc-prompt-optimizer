import { CoreValidationError } from "./errors.js";
import type { CoreErrorCode } from "./errors.js";

export const MAX_OWN_PROPERTY_COUNT = 1_024;
export const MAX_ARRAY_ENTRIES = 1_024;
export const MAX_OWN_PROPERTY_NAME_CHARACTERS = 16_384;

export function ownPropertyNames(
  value: object,
  code: CoreErrorCode,
  label: string,
  excludeArrayLength = false,
): string[] {
  const allNames = Object.getOwnPropertyNames(value);
  const names = excludeArrayLength
    ? allNames.filter((name) => name !== "length")
    : allNames;
  if (names.length > MAX_OWN_PROPERTY_COUNT) {
    throw new CoreValidationError(
      code,
      `${label} has ${names.length} own properties; limit is ${MAX_OWN_PROPERTY_COUNT}.`,
    );
  }
  let nameCharacters = 0;
  for (const name of names) {
    nameCharacters += name.length;
    if (nameCharacters > MAX_OWN_PROPERTY_NAME_CHARACTERS) {
      throw new CoreValidationError(
        code,
        `${label} has ${nameCharacters} property-name characters; limit is ${MAX_OWN_PROPERTY_NAME_CHARACTERS}.`,
      );
    }
  }
  return names.sort();
}

export function hasOwnField(record: object, name: string): boolean {
  return Object.getOwnPropertyDescriptor(record, name) !== undefined;
}

export function readOwnField(record: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function expectRecord(
  value: unknown,
  code: CoreErrorCode,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CoreValidationError(code, `${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CoreValidationError(code, `${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CoreValidationError(code, `${label} must not contain symbol-keyed fields.`);
  }
  for (const key of ownPropertyNames(value, code, label)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new CoreValidationError(code, `${label} field '${key}' must be a data property.`);
    }
  }
  return value as Record<string, unknown>;
}

export function expectDenseArray(
  value: unknown,
  code: CoreErrorCode,
  label: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new CoreValidationError(code, `${label} must be an array.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CoreValidationError(code, `${label} must not contain symbol-keyed fields.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    throw new CoreValidationError(code, `${label} length must be a data property.`);
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_ENTRIES) {
    throw new CoreValidationError(
      code,
      `${label} has ${String(length)} entries; limit is ${MAX_ARRAY_ENTRIES}.`,
    );
  }
  const indices: number[] = [];
  const entries: unknown[] = [];
  for (const key of ownPropertyNames(value, code, label, true)) {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new CoreValidationError(code, `${label} must not contain non-index field '${key}'.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new CoreValidationError(code, `${label} entry at index ${index} must be a data property.`);
    }
    indices.push(index);
    entries[index] = descriptor.value;
  }
  indices.sort((left, right) => left - right);
  if (indices.length !== length) {
    const missing = indices.findIndex((index, position) => index !== position);
    const missingIndex = missing === -1 ? indices.length : missing;
    throw new CoreValidationError(code, `${label} must not contain sparse entries (missing index ${missingIndex}).`);
  }
  if (prototype === Array.prototype) return value;

  const normalized: unknown[] = [];
  normalized.length = length;
  for (let index = 0; index < length; index += 1) {
    Object.defineProperty(normalized, String(index), {
      configurable: true,
      enumerable: true,
      value: entries[index],
      writable: true,
    });
  }
  return normalized;
}

export function expectString(
  value: unknown,
  code: CoreErrorCode,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new CoreValidationError(code, `${label} must be a string.`);
  }
  return value;
}

export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: CoreErrorCode,
  label: string,
): void {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    throw new CoreValidationError(code, `${label} must not contain symbol-keyed fields.`);
  }
  const allowedSet = new Set(allowed);
  const unknown = ownPropertyNames(record, code, label).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new CoreValidationError(code, `${label} has unknown field(s): ${unknown.join(", ")}.`);
  }
}
