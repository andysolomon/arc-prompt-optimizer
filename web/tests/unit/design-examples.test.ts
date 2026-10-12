import { describe, expect, it } from "vitest";
import { DESIGN_EXAMPLES, DESIGN_GROUPS, getDesignExample } from "@/lib/design-examples";
import { buildPatternCandidates } from "@/lib/pattern-candidates";
import { PATTERN_EXAMPLES } from "@/lib/pattern-examples";
import { PROMPT_CATEGORIES, categorySchema } from "@/lib/prompt-library";
import { candidateCount, MAX_PROMPT_CHARACTERS } from "@/lib/types";

describe("design examples", () => {
  it("covers every design group with complete, loadable prompts", () => {
    expect(DESIGN_EXAMPLES).toHaveLength(50);
    expect(DESIGN_EXAMPLES.map((example) => example.number)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(new Set(DESIGN_EXAMPLES.map((example) => example.id)).size).toBe(DESIGN_EXAMPLES.length);
    expect(new Set(DESIGN_EXAMPLES.map((example) => example.title)).size).toBe(DESIGN_EXAMPLES.length);
    expect(new Set(DESIGN_EXAMPLES.map((example) => example.group))).toEqual(new Set(Object.keys(DESIGN_GROUPS)));
    for (const example of DESIGN_EXAMPLES) {
      expect(example.id).toMatch(/^[a-z0-9-]+$/u);
      expect(example.title.trim()).toBe(example.title);
      expect(example.description).toMatch(/\.$/u);
      expect(example.prompt.trim()).toBe(example.prompt);
      expect(example.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARACTERS);
      expect(example.prompt).toMatch(/\[[A-Z][A-Z ,.'0-9-]*(?:, e\.g\. [^\]]+)?\]/u);
      expect(example.prompt).toMatch(/\nOUTPUT:\n/u);
      expect(example.prompt).toMatch(/\nSTRICT:\n/u);
      expect(example.prompt).not.toMatch(/\{\{\w+\}\}/u);
      expect(buildPatternCandidates(example.prompt)).toHaveLength(candidateCount(false));
      expect(getDesignExample(example.id)).toBe(example);
    }
    expect(getDesignExample("unknown")).toBeUndefined();
  });

  it("keeps design ids distinct from pattern anchors and lists groups in catalog order", () => {
    const patternIds = new Set(PATTERN_EXAMPLES.map((example) => example.pattern));
    for (const example of DESIGN_EXAMPLES) expect(patternIds.has(example.id)).toBe(false);
    const order = Object.keys(DESIGN_GROUPS);
    const seen = DESIGN_EXAMPLES.map((example) => order.indexOf(example.group));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("has a Design library category that Jev can choose", () => {
    expect(categorySchema.options).toContain("design");
    expect(PROMPT_CATEGORIES.design.label).toBe("Design");
    expect(categorySchema.options.at(-1)).toBe("other");
    expect(Object.keys(PROMPT_CATEGORIES)).toEqual(categorySchema.options);
  });
});
