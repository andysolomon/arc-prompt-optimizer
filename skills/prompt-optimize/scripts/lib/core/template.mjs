import { CoreValidationError } from "./errors.mjs";
import { expectRecord, expectString, hasOwnField, ownPropertyNames, readOwnField, rejectUnknownKeys, } from "./validation.mjs";
export const DEFAULT_TEMPLATE_RENDER_LIMITS = Object.freeze({
    maxVariableCharacters: 16_384,
    maxTotalVariableCharacters: 32_768,
    maxRenderedCharacters: 48_000,
});
export const MAX_TEMPLATE_CHARACTERS = 48_000;
const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
function malformed(message, offset) {
    throw new CoreValidationError("MALFORMED_TEMPLATE", `Malformed template at offset ${offset}: ${message}`);
}
export function parseTemplate(template) {
    expectString(template, "MALFORMED_TEMPLATE", "Template");
    if (template.length > MAX_TEMPLATE_CHARACTERS) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Template is ${template.length} characters; limit is ${MAX_TEMPLATE_CHARACTERS}.`);
    }
    const tokens = [];
    let textStart = 0;
    let offset = 0;
    while (offset < template.length) {
        if (template.startsWith("{{", offset)) {
            if (offset > textStart) {
                tokens.push({ kind: "text", value: template.slice(textStart, offset) });
            }
            const close = template.indexOf("}}", offset + 2);
            if (close === -1)
                malformed("missing closing '}}'", offset);
            const name = template.slice(offset + 2, close);
            if (!VARIABLE_NAME.test(name)) {
                malformed("variables must match [A-Za-z][A-Za-z0-9_]* with no whitespace", offset);
            }
            tokens.push({ kind: "variable", name });
            offset = close + 2;
            textStart = offset;
            continue;
        }
        if (template.startsWith("}}", offset))
            malformed("unexpected closing '}}'", offset);
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
export function templateVariableNames(template) {
    const names = new Set();
    for (const token of parseTemplate(template)) {
        if (token.kind === "variable")
            names.add(token.name);
    }
    return Object.freeze([...names].sort());
}
function validateLimits(value) {
    const limits = expectRecord(value, "INVALID_PATTERN", "Template render limits");
    rejectUnknownKeys(limits, ["maxVariableCharacters", "maxTotalVariableCharacters", "maxRenderedCharacters"], "INVALID_PATTERN", "Template render limits");
    const checked = {};
    for (const name of [
        "maxVariableCharacters",
        "maxTotalVariableCharacters",
        "maxRenderedCharacters",
    ]) {
        const limit = readOwnField(limits, name);
        if (!Number.isSafeInteger(limit) || limit <= 0) {
            throw new CoreValidationError("INVALID_PATTERN", `Template render limit '${name}' must be a positive safe integer.`);
        }
        checked[name] = limit;
    }
    return Object.freeze(checked);
}
export function encodedTemplateValueLength(value) {
    let length = value.length;
    for (const character of value) {
        if (character === "&" || character === "'")
            length += 4;
        else if (character === "<" || character === ">")
            length += 3;
        else if (character === '"')
            length += 5;
    }
    return length;
}
export function escapeTemplateValue(value) {
    expectString(value, "INVALID_VARIABLE_VALUE", "Template value");
    return value.replace(/[&<>"']/gu, (character) => {
        if (character === "&")
            return "&amp;";
        if (character === "<")
            return "&lt;";
        if (character === ">")
            return "&gt;";
        if (character === '"')
            return "&quot;";
        return "&#39;";
    });
}
export function calculateRenderedLength(tokens, variables) {
    let length = 0;
    for (const token of tokens) {
        length +=
            token.kind === "text"
                ? token.value.length
                : encodedTemplateValueLength(readOwnField(variables, token.name));
    }
    return length;
}
export function joinRenderedTemplate(tokens, variables) {
    const escaped = new Map();
    return tokens
        .map((token) => {
        if (token.kind === "text")
            return token.value;
        const existing = escaped.get(token.name);
        if (existing !== undefined)
            return existing;
        const value = escapeTemplateValue(readOwnField(variables, token.name));
        escaped.set(token.name, value);
        return value;
    })
        .join("");
}
export function renderTemplate(template, variables, limits = DEFAULT_TEMPLATE_RENDER_LIMITS) {
    expectString(template, "MALFORMED_TEMPLATE", "Template");
    const suppliedVariables = expectRecord(variables, "INVALID_VARIABLE_VALUE", "Template variables");
    const checkedLimits = validateLimits(limits);
    const tokens = parseTemplate(template);
    const suppliedNames = ownPropertyNames(suppliedVariables, "INVALID_VARIABLE_VALUE", "Template variables");
    const referenced = new Set(tokens.filter((token) => token.kind === "variable").map((token) => token.name));
    const missing = [...referenced]
        .filter((name) => !hasOwnField(suppliedVariables, name))
        .sort();
    if (missing.length > 0) {
        throw new CoreValidationError("MISSING_VARIABLES", `Missing template variables: ${missing.join(", ")}.`);
    }
    const unknown = suppliedNames.filter((name) => !referenced.has(name));
    if (unknown.length > 0) {
        throw new CoreValidationError("UNKNOWN_VARIABLES", `Unknown template variables: ${unknown.join(", ")}. Expected: ${[...referenced].sort().join(", ")}.`);
    }
    let totalCharacters = 0;
    for (const name of referenced) {
        const value = readOwnField(suppliedVariables, name);
        if (typeof value !== "string") {
            throw new CoreValidationError("INVALID_VARIABLE_VALUE", `Template variable '${name}' must be a string.`);
        }
        if (value.length > checkedLimits.maxVariableCharacters) {
            throw new CoreValidationError("INPUT_TOO_LARGE", `Template variable '${name}' is ${value.length} characters; limit is ${checkedLimits.maxVariableCharacters}.`);
        }
        totalCharacters += value.length;
    }
    if (totalCharacters > checkedLimits.maxTotalVariableCharacters) {
        throw new CoreValidationError("INPUT_TOO_LARGE", `Template variables total ${totalCharacters} characters; limit is ${checkedLimits.maxTotalVariableCharacters}.`);
    }
    const checkedVariables = suppliedVariables;
    const renderedLength = calculateRenderedLength(tokens, checkedVariables);
    if (renderedLength > checkedLimits.maxRenderedCharacters) {
        throw new CoreValidationError("OUTPUT_TOO_LARGE", `Rendered template is ${renderedLength} characters; limit is ${checkedLimits.maxRenderedCharacters}.`);
    }
    return joinRenderedTemplate(tokens, checkedVariables);
}
