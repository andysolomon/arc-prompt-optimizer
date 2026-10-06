import type { OptimizeRequestBody, OptimizeResult, StepEvent } from "@/lib/types";

export class OptimizeRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OptimizeRequestError";
    this.status = status;
  }
}

interface SseMessage {
  readonly event: string;
  readonly data: string;
}

/** Splits a text/event-stream buffer into complete messages; returns the unconsumed remainder. */
export function parseSseChunk(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const normalized = buffer.replace(/\r\n/gu, "\n");
  let index: number;
  let rest = normalized;
  while ((index = rest.indexOf("\n\n")) !== -1) {
    const block = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
    }
    if (data.length > 0) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}

/**
 * POSTs to `/api/optimize` with `Accept: text/event-stream`, reports each step, and resolves with the final
 * result. Aborting `signal` cancels the fetch, which aborts the server run.
 */
export async function streamOptimize(
  body: OptimizeRequestBody,
  signal: AbortSignal,
  onStep: (event: StepEvent) => void,
): Promise<OptimizeResult> {
  const response = await fetch("/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}.`;
    try {
      const json = (await response.json()) as { error?: unknown };
      if (typeof json.error === "string") message = json.error;
    } catch {
      /* non-JSON error body */
    }
    throw new OptimizeRequestError(response.status, message);
  }
  if (response.body === null) throw new Error("The server returned no stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: OptimizeResult | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      if (message.event === "result") {
        result = JSON.parse(message.data) as OptimizeResult;
      } else if (message.event === "error") {
        const payload = JSON.parse(message.data) as { error?: string };
        throw new Error(payload.error ?? "Optimization failed.");
      } else {
        onStep(JSON.parse(message.data) as StepEvent);
      }
    }
  }
  if (result === undefined) throw new Error("The run ended before a result was returned.");
  return result;
}
