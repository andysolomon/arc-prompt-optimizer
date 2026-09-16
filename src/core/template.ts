import { CoreValidationError } from "./errors.js";
import {
  expectRecord,
  expectString,
  hasOwnField,
  ownPropertyNames,
  readOwnField,
  rejectUnknownKeys,
} from "./validation.js";

export interface TemplateTextToken {
  readonly kind: "text";
  readonly value: string;
}

export interface TemplateVariableToken {
  readonly kind: "variable";
  readonly name: string;
}

export type TemplateToken = TemplateTextToken | TemplateVariableToken;

export interface TemplateRenderLimits {
  readonly maxVariableCharacters: number;
  readonly maxTotalVariableCharacters: number;
  readonly maxRenderedCharacters: number;
}

export const DEFAULT_TEMPLATE_RENDER_LIMITS: Readonly<TemplateRenderLimits> = Object.freeze({
  maxVariableCharacters: 16_384,
  maxTotalVariableCharacters: 32_768,
  maxRenderedCharacters: 48_000,
});

export const MAX_TEMPLATE_CHARACTERS = 48_000;

const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function malformed(message: string, offset: number): never {
  throw new CoreValidationError(
    "MALFORMED_TEMPLATE",
    `Malformed template at offset ${offset}: ${message}`,
  );
}

export function parseTemplate(template: string): readonly TemplateToken[] {
  expectString(template, "MALFORMED_TEMPLATE", "Template");
  if (template.length > MAX_TEMPLATE_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Template is ${template.length} characters; limit is ${MAX_TEMPLATE_CHARACTERS}.`,
    );
  }
  const tokens: TemplateToken[] = [];
  let textStart = 0;
  let offset = 0;

  while (offset < template.length) {
    if (template.startsWith("{{", offset)) {
      if (offset > textStart) {
        tokens.push({ kind: "text", value: template.slice(textStart, offset) });
      }

      const close = template.indexOf("}}", offset + 2);
      if (close === -1) malformed("missing closing '}}'", offset);

      const name = template.slice(offset + 2, close);
      if (!VARIABLE_NAME.test(name)) {
        malformed("variables must match [A-Za-z][A-Za-z0-9_]* with no whitespace", offset);
      }

      tokens.push({ kind: "variable", name });
      offset = close + 2;
      textStart = offset;
      continue;
    }

    if (template.startsWith("}}", offset)) malformed("unexpected closing '}}'", offset);
    if (template[offset] === "{" || template[offset] === "}") {
      malformed("literal braces are not allowed; variables use '{{name}}'", offset);
    }
    offset += 1;
  }

  if (textStart < template.length) {
    tokens.push({ kind: "text", value: template.slice(textStart) });
  }

  return Object.freeze(tokens.map((token) => Object.freeze(token)));
}

export function templateVariableNames(template: string): readonly string[] {
  const names = new Set<string>();
  for (const token of parseTemplate(template)) {
    if (token.kind === "variable") names.add(token.name);
  }
  return Object.freeze([...names].sort());
}

function validateLimits(value: unknown): TemplateRenderLimits {
  const limits = expectRecord(value, "INVALID_PATTERN", "Template render limits");
  rejectUnknownKeys(
    limits,
    ["maxVariableCharacters", "maxTotalVariableCharacters", "maxRenderedCharacters"],
    "INVALID_PATTERN",
    "Template render limits",
  );
  const checked = {} as Record<keyof TemplateRenderLimits, number>;
  for (const name of [
    "maxVariableCharacters",
    "maxTotalVariableCharacters",
    "maxRenderedCharacters",
  ] as const) {
    const limit = readOwnField(limits, name);
    if (!Number.isSafeInteger(limit) || (limit as number) <= 0) {
      throw new CoreValidationError(
        "INVALID_PATTERN",
        `Template render limit '${name}' must be a positive safe integer.`,
      );
    }
    checked[name] = limit as number;
  }
  return Object.freeze(checked);
}

export function encodedTemplateValueLength(value: string): number {
  let length = value.length;
  for (const character of value) {
    if (character === "&" || character === "'") length += 4;
    else if (character === "<" || character === ">") length += 3;
    else if (character === '"') length += 5;
  }
  return length;
}

export function escapeTemplateValue(value: string): string {
  expectString(value, "INVALID_VARIABLE_VALUE", "Template value");
  return value.replace(/[&<>"']/gu, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

export function calculateRenderedLength(
  tokens: readonly TemplateToken[],
  variables: Readonly<Record<string, string>>,
): number {
  let length = 0;
  for (const token of tokens) {
    length +=
      token.kind === "text"
        ? token.value.length
        : encodedTemplateValueLength(readOwnField(variables as object, token.name) as string);
  }
  return length;
}

export function joinRenderedTemplate(
  tokens: readonly TemplateToken[],
  variables: Readonly<Record<string, string>>,
): string {
  const escaped = new Map<string, string>();
  return tokens
    .map((token) => {
      if (token.kind === "text") return token.value;
      const existing = escaped.get(token.name);
      if (existing !== undefined) return existing;
      const value = escapeTemplateValue(readOwnField(variables as object, token.name) as string);
      escaped.set(token.name, value);
      return value;
    })
    .join("");
}

export function renderTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
  limits: TemplateRenderLimits = DEFAULT_TEMPLATE_RENDER_LIMITS,
): string {
  expectString(template, "MALFORMED_TEMPLATE", "Template");
  const suppliedVariables = expectRecord(variables, "INVALID_VARIABLE_VALUE", "Template variables");
  const checkedLimits = validateLimits(limits);
  const tokens = parseTemplate(template);
  const suppliedNames = ownPropertyNames(
    suppliedVariables,
    "INVALID_VARIABLE_VALUE",
    "Template variables",
  );
  const referenced = new Set(
    tokens.filter((token): token is TemplateVariableToken => token.kind === "variable").map((token) => token.name),
  );
  const missing = [...referenced]
    .filter((name) => !hasOwnField(suppliedVariables, name))
    .sort();
  if (missing.length > 0) {
    throw new CoreValidationError(
      "MISSING_VARIABLES",
      `Missing template variables: ${missing.join(", ")}.`,
    );
  }
  const unknown = suppliedNames.filter((name) => !referenced.has(name));
  if (unknown.length > 0) {
    throw new CoreValidationError(
      "UNKNOWN_VARIABLES",
      `Unknown template variables: ${unknown.join(", ")}. Expected: ${[...referenced].sort().join(", ")}.`,
    );
  }
  let totalCharacters = 0;
  for (const name of referenced) {
    const value: unknown = readOwnField(suppliedVariables, name);
    if (typeof value !== "string") {
      throw new CoreValidationError(
        "INVALID_VARIABLE_VALUE",
        `Template variable '${name}' must be a string.`,
      );
    }
    if (value.length > checkedLimits.maxVariableCharacters) {
      throw new CoreValidationError(
        "INPUT_TOO_LARGE",
        `Template variable '${name}' is ${value.length} characters; limit is ${checkedLimits.maxVariableCharacters}.`,
      );
    }
    totalCharacters += value.length;
  }
  if (totalCharacters > checkedLimits.maxTotalVariableCharacters) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Template variables total ${totalCharacters} characters; limit is ${checkedLimits.maxTotalVariableCharacters}.`,
    );
  }

  const checkedVariables = suppliedVariables as Readonly<Record<string, string>>;
  const renderedLength = calculateRenderedLength(tokens, checkedVariables);
  if (renderedLength > checkedLimits.maxRenderedCharacters) {
    throw new CoreValidationError(
      "OUTPUT_TOO_LARGE",
      `Rendered template is ${renderedLength} characters; limit is ${checkedLimits.maxRenderedCharacters}.`,
    );
  }
  return joinRenderedTemplate(tokens, checkedVariables);
}
