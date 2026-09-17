import { CoreValidationError } from "./errors.mjs";
import { calculateRenderedLength, joinRenderedTemplate, parseTemplate, templateVariableNames, } from "./template.mjs";
import { expectDenseArray, expectRecord, expectString, hasOwnField, ownPropertyNames, readOwnField, rejectUnknownKeys, } from "./validation.mjs";
export const DEFAULT_RENDER_LIMITS = Object.freeze({
    maxVariableCharacters: 16_384,
    maxTotalVariableCharacters: 32_768,
    maxRenderedCharacters: 48_000,
});
export const EXPLICIT_GENERATION_GUIDANCE = Object.freeze({
    activation: "explicit",
    automatic: false,
    notes: "Candidate generation must be explicitly requested by the caller; rendering never intercepts, submits, or rewrites prompts automatically.",
});
function pattern(value) {
    return Object.freeze({
        ...value,
        variables: Object.freeze([...value.variables]),
        generationGuidance: EXPLICIT_GENERATION_GUIDANCE,
    });
}
export const PROMPT_PATTERNS = Object.freeze([
    pattern({
        name: "persona",
        displayName: "Persona Pattern",
        description: "Sets a specific role, experience, communication style, and priority.",
        template: "You are {{role}} with {{experience}}.\nYour communication style is {{style}}.\nYou prioritize {{priority}}.\n\n<task>\n{{task}}\n</task>",
        variables: ["role", "experience", "style", "priority", "task"],
        recommendedTemperature: 0.7,
    }),
    pattern({
        name: "few_shot",
        displayName: "Few-Shot Pattern",
        description: "Provides concrete examples that anchor output format and style.",
        template: "Here are examples of the expected input/output format:\n\n<examples>\n{{examples}}\n</examples>\n\nNow process this input:\n<input>\n{{input}}\n</input>",
        variables: ["examples", "input"],
        recommendedTemperature: 0,
    }),
    pattern({
        name: "chain_of_thought",
        displayName: "Structured Reasoning Pattern",
        description: "Requests a structured analysis followed by a clearly identified conclusion.",
        template: "Analyze the problem in a structured way.\n\n<problem>\n{{problem}}\n</problem>\n\n1. Identify the key components.\n2. Analyze each component.\n3. Synthesize the findings.\n4. State a concise final conclusion.",
        variables: ["problem"],
        recommendedTemperature: 0.3,
    }),
    pattern({
        name: "template_fill",
        displayName: "Template Fill Pattern",
        description: "Extracts supplied information into a caller-provided structure.",
        template: "Extract information from <source_text> and fill every field in <output_template>. If information is unavailable, write 'N/A'.\n\n<source_text>\n{{text}}\n</source_text>\n\n<output_template>\n{{template_structure}}\n</output_template>",
        variables: ["text", "template_structure"],
        recommendedTemperature: 0,
    }),
    pattern({
        name: "critique",
        displayName: "Critique Pattern",
        description: "Separates an initial answer, critique, and improved final answer.",
        template: "<task>\n{{task}}\n</task>\n\nStep 1: Generate an initial response.\nStep 2: Critique it for accuracy, completeness, and clarity.\nStep 3: Produce an improved final version.\n\nLabel each step clearly.",
        variables: ["task"],
        recommendedTemperature: 0.5,
    }),
    pattern({
        name: "guardrail",
        displayName: "Guardrail Pattern",
        description: "Defines domain rules and an uncertainty policy around a user question.",
        template: "You are a {{role}}.\n\nRules:\n- Only answer questions about {{domain}}.\n- If the question is outside {{domain}}, say: 'This is outside my scope.'\n- Never invent information. If unsure, say: 'I do not know.'\n- {{additional_rules}}\n\n<user_question>\n{{question}}\n</user_question>",
        variables: ["role", "domain", "additional_rules", "question"],
        recommendedTemperature: 0.3,
    }),
    pattern({
        name: "decomposition",
        displayName: "Decomposition Pattern",
        description: "Breaks a complex problem into independently handled sub-problems.",
        template: "<problem>\n{{problem}}\n</problem>\n\nBreak this into sub-problems:\n1. List each sub-problem.\n2. Solve each independently.\n3. Combine the sub-solutions into a final answer.\n4. Verify the final answer against the original problem.",
        variables: ["problem"],
        recommendedTemperature: 0.3,
    }),
    pattern({
        name: "audience_adapt",
        displayName: "Audience Adaptation Pattern",
        description: "Adapts vocabulary, length, inclusions, and exclusions to an audience.",
        template: "Explain <concept>{{concept}}</concept> for this audience: <audience>{{audience}}</audience>.\n\nConstraints:\n- Use vocabulary appropriate for the audience.\n- Length: {{length}}\n- Include: {{include}}\n- Exclude: {{exclude}}",
        variables: ["concept", "audience", "length", "include", "exclude"],
        recommendedTemperature: 0.5,
    }),
    pattern({
        name: "boundary",
        displayName: "Boundary Pattern",
        description: "Establishes a hard scope and exact response for out-of-scope requests.",
        template: "You are an assistant that only handles {{scope}}.\n\nIf the request is within scope, help fully.\nIf it is outside scope, respond exactly with:\n'{{refusal_message}}'\n\nDo not answer out-of-scope requests.\n\n<user_input>\n{{user_input}}\n</user_input>",
        variables: ["scope", "refusal_message", "user_input"],
        recommendedTemperature: 0,
    }),
]);
function validateLimits(value) {
    const limits = expectRecord(value, "INVALID_PATTERN", "Render limits");
    rejectUnknownKeys(limits, ["maxVariableCharacters", "maxTotalVariableCharacters", "maxRenderedCharacters"], "INVALID_PATTERN", "Render limits");
    const checked = {};
    for (const name of [
        "maxVariableCharacters",
        "maxTotalVariableCharacters",
        "maxRenderedCharacters",
    ]) {
        const limit = readOwnField(limits, name);
        if (!Number.isSafeInteger(limit) || limit <= 0) {
            throw new CoreValidationError("INVALID_PATTERN", `Render limit '${name}' must be a positive safe integer.`);
        }
        checked[name] = limit;
    }
    return Object.freeze(checked);
}
function validateGenerationGuidance(value, patternName) {
    if (value === undefined)
        return undefined;
    const guidance = expectRecord(value, "INVALID_PATTERN", `Pattern '${patternName}' generationGuidance`);
    rejectUnknownKeys(guidance, ["activation", "automatic", "notes"], "INVALID_PATTERN", `Pattern '${patternName}' generationGuidance`);
    const activation = readOwnField(guidance, "activation");
    const automatic = readOwnField(guidance, "automatic");
    if (activation !== "explicit" || automatic !== false) {
        throw new CoreValidationError("INVALID_PATTERN", `Pattern '${patternName}' generationGuidance must be explicit and non-automatic.`);
    }
    const notes = expectString(readOwnField(guidance, "notes"), "INVALID_PATTERN", `Pattern '${patternName}' generationGuidance.notes`);
    return Object.freeze({ activation: "explicit", automatic: false, notes });
}
function validatePattern(value) {
    const definition = expectRecord(value, "INVALID_PATTERN", "Pattern definition");
    rejectUnknownKeys(definition, ["name", "displayName", "description", "template", "variables", "recommendedTemperature", "generationGuidance"], "INVALID_PATTERN", "Pattern definition");
    const name = expectString(readOwnField(definition, "name"), "INVALID_PATTERN", "Pattern name");
    const displayName = expectString(readOwnField(definition, "displayName"), "INVALID_PATTERN", `Pattern '${name}' displayName`);
    const description = expectString(readOwnField(definition, "description"), "INVALID_PATTERN", `Pattern '${name}' description`);
    const template = expectString(readOwnField(definition, "template"), "INVALID_PATTERN", `Pattern '${name}' template`);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new CoreValidationError("INVALID_PATTERN", `Pattern name '${name}' must match [a-z][a-z0-9_]*.`);
    }
    const recommendedTemperature = readOwnField(definition, "recommendedTemperature");
    if (typeof recommendedTemperature !== "number" || !Number.isFinite(recommendedTemperature)) {
        throw new CoreValidationError("INVALID_PATTERN", `Pattern '${name}' recommendedTemperature must be a finite number.`);
    }
    const declared = expectDenseArray(readOwnField(definition, "variables"), "INVALID_PATTERN", `Pattern '${name}' variables`).map((variable, index) => expectString(variable, "INVALID_PATTERN", `Pattern '${name}' variable at index ${index}`));
    for (const variable of declared) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable)) {
            throw new CoreValidationError("INVALID_PATTERN", `Pattern '${name}' variable '${variable}' must match [A-Za-z][A-Za-z0-9_]*.`);
        }
    }
    const uniqueDeclared = new Set(declared);
    if (uniqueDeclared.size !== declared.length) {
        throw new CoreValidationError("INVALID_PATTERN", `Pattern '${name}' declares duplicate variables.`);
    }
    const referenced = templateVariableNames(template);
    const missingFromTemplate = declared.filter((name) => !referenced.includes(name)).sort();
    const undeclared = referenced.filter((name) => !uniqueDeclared.has(name)).sort();
    if (missingFromTemplate.length > 0 || undeclared.length > 0) {
        throw new CoreValidationError("INVALID_PATTERN", `Pattern '${name}' variable mismatch: unused declarations [${missingFromTemplate.join(", ")}]; undeclared template variables [${undeclared.join(", ")}].`);
    }
    const generationGuidance = validateGenerationGuidance(readOwnField(definition, "generationGuidance"), name);
    return {
        name,
        displayName,
        description,
        template,
        variables: declared,
        recommendedTemperature,
        ...(generationGuidance === undefined ? {} : { generationGuidance }),
    };
}
export class PatternCatalog {
    #patterns;
    #limits;
    constructor(definitions, limits = DEFAULT_RENDER_LIMITS) {
        const checkedLimits = validateLimits(limits);
        const checkedDefinitions = expectDenseArray(definitions, "INVALID_PATTERN", "Pattern definitions");
        const patterns = new Map();
        for (const value of checkedDefinitions) {
            const definition = validatePattern(value);
            if (patterns.has(definition.name)) {
                throw new CoreValidationError("INVALID_PATTERN", `Pattern name '${definition.name}' is duplicated.`);
            }
            patterns.set(definition.name, Object.freeze({
                ...definition,
                variables: Object.freeze([...definition.variables]),
                ...(readOwnField(definition, "generationGuidance") === undefined
                    ? {}
                    : {
                        generationGuidance: Object.freeze({
                            ...readOwnField(definition, "generationGuidance"),
                        }),
                    }),
            }));
        }
        this.#patterns = patterns;
        this.#limits = Object.freeze({ ...checkedLimits });
    }
    list() {
        return Object.freeze([...this.#patterns.values()]);
    }
    get(name) {
        expectString(name, "INVALID_PATTERN", "Pattern name");
        const definition = this.#patterns.get(name);
        if (!definition) {
            throw new CoreValidationError("UNKNOWN_PATTERN", `Unknown pattern '${name}'. Available patterns: ${[...this.#patterns.keys()].sort().join(", ")}.`);
        }
        return definition;
    }
    render(name, variables) {
        const definition = this.get(name);
        const checkedVariables = expectRecord(variables, "INVALID_VARIABLE_VALUE", `Variables for pattern '${name}'`);
        const supplied = ownPropertyNames(checkedVariables, "INVALID_VARIABLE_VALUE", `Variables for pattern '${name}'`);
        const expected = new Set(definition.variables);
        const missing = definition.variables.filter((variable) => !hasOwnField(checkedVariables, variable));
        if (missing.length > 0) {
            throw new CoreValidationError("MISSING_VARIABLES", `Missing variables for pattern '${name}': ${[...missing].sort().join(", ")}.`);
        }
        const unknown = supplied.filter((variable) => !expected.has(variable)).sort();
        if (unknown.length > 0) {
            throw new CoreValidationError("UNKNOWN_VARIABLES", `Unknown variables for pattern '${name}': ${unknown.join(", ")}. Expected: ${[...definition.variables].sort().join(", ")}.`);
        }
        let totalCharacters = 0;
        for (const variable of definition.variables) {
            const value = readOwnField(checkedVariables, variable);
            if (typeof value !== "string") {
                throw new CoreValidationError("INVALID_VARIABLE_VALUE", `Variable '${variable}' for pattern '${name}' must be a string.`);
            }
            if (value.length > this.#limits.maxVariableCharacters) {
                throw new CoreValidationError("INPUT_TOO_LARGE", `Variable '${variable}' for pattern '${name}' is ${value.length} characters; limit is ${this.#limits.maxVariableCharacters}.`);
            }
            totalCharacters += value.length;
        }
        if (totalCharacters > this.#limits.maxTotalVariableCharacters) {
            throw new CoreValidationError("INPUT_TOO_LARGE", `Variables for pattern '${name}' total ${totalCharacters} characters; limit is ${this.#limits.maxTotalVariableCharacters}.`);
        }
        const tokens = parseTemplate(definition.template);
        const stringVariables = checkedVariables;
        const renderedLength = calculateRenderedLength(tokens, stringVariables);
        if (renderedLength > this.#limits.maxRenderedCharacters) {
            throw new CoreValidationError("OUTPUT_TOO_LARGE", `Rendered pattern '${name}' is ${renderedLength} characters; limit is ${this.#limits.maxRenderedCharacters}.`);
        }
        const text = joinRenderedTemplate(tokens, stringVariables);
        return Object.freeze({
            pattern: definition.name,
            text,
            variablesUsed: Object.freeze([...definition.variables]),
        });
    }
}
export const defaultPatternCatalog = new PatternCatalog(PROMPT_PATTERNS);
export function listPatterns() {
    return defaultPatternCatalog.list();
}
export function getPattern(name) {
    return defaultPatternCatalog.get(name);
}
export function renderPattern(name, variables) {
    return defaultPatternCatalog.render(name, variables);
}
