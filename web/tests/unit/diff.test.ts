import { describe, expect, it } from "vitest";
import { lineDiffSummary } from "@/lib/diff";

describe("lineDiffSummary", () => {
  it("reports no changes for identical text", () => {
    expect(lineDiffSummary("a\nb", "a\nb")).toEqual({ added: 0, removed: 0, unchanged: 2, summary: "+0 -0 lines" });
  });

  it("treats empty text as zero lines", () => {
    expect(lineDiffSummary("", "")).toEqual({ added: 0, removed: 0, unchanged: 0, summary: "+0 -0 lines" });
    expect(lineDiffSummary("", "x\ny")).toMatchObject({ added: 2, removed: 0 });
    expect(lineDiffSummary("x", "")).toMatchObject({ added: 0, removed: 1 });
  });

  it("counts wrapped templates as added lines with the source kept", () => {
    const source = "Summarize this incident report for executives.";
    const candidate = `<task>\n${source}\n</task>\n\nStep 1: Generate an initial response.`;
    expect(lineDiffSummary(source, candidate)).toMatchObject({ added: 4, removed: 0, unchanged: 1 });
  });

  it("uses a longest common subsequence for interior edits", () => {
    expect(lineDiffSummary("a\nb\nc\nd", "a\nx\nc\ny\nd")).toEqual({ added: 2, removed: 1, unchanged: 3, summary: "+2 -1 lines" });
  });

  it("accepts CRLF line endings", () => {
    expect(lineDiffSummary("a\r\nb", "a\nb\nc")).toMatchObject({ added: 1, removed: 0 });
  });
});
