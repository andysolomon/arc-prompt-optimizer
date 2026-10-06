import { describe, expect, it } from "vitest";
import { parseSseChunk } from "@/lib/client/sse";
import { progressPercent, stepLabels } from "@/lib/client/steps";

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
  it("lists seven steps with the judge and six without", () => {
    expect(stepLabels(true)).toHaveLength(7);
    expect(stepLabels(false)).toHaveLength(6);
    expect(stepLabels(true)[5]).toBe("Score outputs with Jev");
  });

  it("advances the progress bar half a step at a time", () => {
    expect(progressPercent(0, 6)).toBe(8);
    expect(progressPercent(3, 6)).toBe(58);
    expect(progressPercent(6, 6)).toBe(92);
  });
});
