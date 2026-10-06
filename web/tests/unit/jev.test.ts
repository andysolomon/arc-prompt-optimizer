import { describe, expect, it } from "vitest";
import {
  JEV_CRITERIA,
  JEV_INSTRUCTIONS,
  JEV_MODEL,
  TYPESAFE_ENDPOINT,
  buildJevRequest,
  judgeWithJev,
  normalizeJevScore,
  parseJevResponse,
  questionKey,
} from "@/lib/jev";

const entries = [
  { candidateId: "baseline-1", prompt: "p0", output: "o0" },
  { candidateId: "critique-2", prompt: "p1", output: "o1" },
];

function answer(score: number, confidence = 0.9) {
  return {
    type: "score",
    score,
    confidence,
    probabilities: { "0": 0, "1": 0.1, "2": 0.2, "3": 0.7 },
    legend: Object.fromEntries(JEV_CRITERIA.map((c, i) => [String(i), c])),
  };
}

describe("normalizeJevScore", () => {
  it("maps the 0..3 scale onto 0..1", () => {
    expect(normalizeJevScore(0)).toBe(0);
    expect(normalizeJevScore(3)).toBe(1);
    expect(normalizeJevScore(1.5)).toBeCloseTo(0.5);
    expect(normalizeJevScore(2.1)).toBeCloseTo(0.7);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(normalizeJevScore(-1)).toBe(0);
    expect(normalizeJevScore(7)).toBe(1);
    expect(normalizeJevScore(Number.NaN)).toBe(0);
  });
});

describe("buildJevRequest", () => {
  it("asks one Score question per candidate in a single request", () => {
    const body = buildJevRequest(entries) as { model: string; state: Record<string, unknown>; questions: Record<string, { type: string; instructions: string; criteria: string[] }> };
    expect(body.model).toBe(JEV_MODEL);
    expect(Object.keys(body.questions)).toEqual([questionKey(0), questionKey(1)]);
    expect(body.state[questionKey(1)]).toEqual({ prompt: "p1", output: "o1" });
    for (const question of Object.values(body.questions)) {
      expect(question.type).toBe("score");
      expect(question.instructions.startsWith(JEV_INSTRUCTIONS)).toBe(true);
      expect(question.criteria).toEqual([...JEV_CRITERIA]);
    }
  });
});

describe("parseJevResponse", () => {
  it("re-keys answers by candidate id and keeps the raw fields", () => {
    const parsed = parseJevResponse(
      { model: "jev-1.13.0", answers: { [questionKey(0)]: answer(1.2), [questionKey(1)]: answer(2.7) } },
      entries,
    );
    expect(parsed.model).toBe("jev-1.13.0");
    expect(parsed.answers["critique-2"]).toMatchObject({ score: 2.7, confidence: 0.9, normalized: 0.9 });
    expect(parsed.answers["critique-2"]!.legend["3"]).toBe(JEV_CRITERIA[3]);
    expect(parsed.answers["baseline-1"]!.normalized).toBeCloseTo(0.4);
  });

  it("rejects a response missing a candidate answer", () => {
    expect(() => parseJevResponse({ answers: { [questionKey(0)]: answer(1) } }, entries)).toThrow(/Missing answer/u);
  });
});

describe("judgeWithJev", () => {
  it("posts to the TypeSafe endpoint with a bearer token", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const report = await judgeWithJev(entries, {
      apiKey: "secret",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify({ model: "jev-1", answers: { [questionKey(0)]: answer(3), [questionKey(1)]: answer(0) } }), { status: 200 });
      }) as typeof fetch,
    });
    expect(seen?.url).toBe(TYPESAFE_ENDPOINT);
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(report.status).toBe("judged");
    if (report.status === "judged") {
      expect(report.answers["baseline-1"]!.normalized).toBe(1);
      expect(report.answers["critique-2"]!.normalized).toBe(0);
    }
  });

  it("degrades to a failed report on HTTP errors and malformed bodies", async () => {
    const http = await judgeWithJev(entries, { apiKey: "k", fetch: (async () => new Response("nope", { status: 503 })) as typeof fetch });
    expect(http).toEqual({ status: "failed", reason: "TypeSafe responded with HTTP 503." });
    const malformed = await judgeWithJev(entries, { apiKey: "k", fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch });
    expect(malformed.status).toBe("failed");
    const thrown = await judgeWithJev(entries, {
      apiKey: "k",
      fetch: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    expect(thrown).toEqual({ status: "failed", reason: "network down" });
  });
});
