import { describe, expect, it } from "vitest";
import { parseSseChunk } from "@/lib/client/sse";
import { advanceSteps, planSteps, progressPercent } from "@/lib/client/steps";

describe("parseSseChunk", () => {
  it("parses complete messages and keeps the partial remainder", () => {
    const { messages, rest } = parseSseChunk('event: render\ndata: {"step":"render"}\n\nevent: run:x\ndata: {"st');
    expect(messages).toEqual([{ event: "render", data: '{"step":"render"}' }]);
    expect(rest).toBe('event: run:x\ndata: {"st');
  });

  it("joins multi-line data and tolerates CRLF", () => {
    const { messages } = parseSseChunk("event: result\r\ndata: {\r\ndata: }\r\n\r\n");
    expect(messages).toEqual([{ event: "result", data: "{\n}" }]);
  });
});

describe("steps", () => {
  it("plans nine steps with the rewrite and judge, six without either", () => {
    expect(planSteps(true, true).steps.map((s) => s.label)).toEqual([
      "Rewrite the prompt",
      "Render 5 candidates",
      "Run baseline",
      "Run rewrite",
      "Run critique",
      "Run decomposition",
      "Run structured reasoning",
      "Score outputs with Jev",
      "Rank candidates",
    ]);
    expect(planSteps(false, false).steps).toHaveLength(6);
  });

  it("replaces planned run steps with the rendered candidates and marks steps done by key", () => {
    let state = planSteps(true, true);
    state = advanceSteps(state, { step: "rewrite", status: "failed" });
    state = advanceSteps(state, {
      step: "render",
      candidateIds: ["b", "c", "d", "s"],
      candidateLabels: ["Baseline", "Critique", "Decomposition", "Structured reasoning"],
    });
    expect(state.steps.map((s) => s.key)).toEqual(["rewrite", "render", "run:b", "run:c", "run:d", "run:s", "judge", "rank"]);
    expect(state.steps[1]!.label).toBe("Render 4 candidates");
    expect(state.steps[5]!.label).toBe("Run structured reasoning");
    state = advanceSteps(state, { step: "run:b" });
    expect(state.done).toEqual(["rewrite", "render", "run:b"]);
  });

  it("advances the progress bar half a step at a time", () => {
    expect(progressPercent(0, 6)).toBe(8);
    expect(progressPercent(3, 6)).toBe(58);
    expect(progressPercent(6, 6)).toBe(92);
  });
});
