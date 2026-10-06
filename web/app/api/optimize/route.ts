import { NextResponse } from "next/server";
import { readServerEnv, mockProvidersEnabled } from "@/lib/env";
import { availableModels } from "@/lib/models";
import { runOptimization } from "@/lib/optimize-run";
import { clientIp, rateLimitMessage, rateLimiterFor } from "@/lib/ratelimit";
import { MODEL_IDS, type StepEvent } from "@/lib/types";
import { validateOptimizeBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Four sequential completions at up to 60 s each plus the judge call. Requires Fluid compute or a Pro plan; Hobby caps at 60 s. */
export const maxDuration = 300;

function wantsEventStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Optimization failed.";
}

export async function POST(request: Request): Promise<Response> {
  const env = readServerEnv();
  const limiter = rateLimiterFor(env);
  const limit = await limiter.limit(clientIp(request.headers));
  if (!limit.success) {
    return NextResponse.json(
      { error: rateLimitMessage(limit) },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const allowed = mockProvidersEnabled(env) ? MODEL_IDS : availableModels(process.env).map((model) => model.id);
  const validation = validateOptimizeBody(body, allowed);
  if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: validation.status });
  const input = validation.value;

  if (!wantsEventStream(request)) {
    try {
      const result = await runOptimization(input, { env, signal: request.signal, emit: () => {} });
      return NextResponse.json(result);
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const emit = (event: StepEvent) => send(event.step, event);
      runOptimization(input, { env, signal: request.signal, emit })
        .then((result) => send("result", result))
        .catch((error: unknown) => {
          if (!request.signal.aborted) send("error", { error: errorMessage(error) });
        })
        .finally(finish);
    },
    cancel() {
      /* client disconnected; request.signal aborts the in-flight completion */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
