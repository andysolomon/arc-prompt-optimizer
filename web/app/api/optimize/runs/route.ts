import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { describeClient } from "@/lib/client-info";
import { readServerEnv, mockProvidersEnabled, refineEnabled } from "@/lib/env";
import { availableModels } from "@/lib/models";
import { clientIp, rateLimitMessage, rateLimiterFor } from "@/lib/ratelimit";
import { executeRun, newRunRecord } from "@/lib/run-job";
import { isRunId, runStoreFor } from "@/lib/run-store";
import { MODEL_IDS } from "@/lib/types";
import { validateOptimizeBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The run executes after the 202 response is sent and needs the same ceiling as the streaming route. */
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Starts a run that is not tied to this connection: the response is a run id, the run executes after the response
 * is sent, and `GET ?id=` reports its steps and, once finished, its result. The client can lose its connection,
 * leave the browser, or reload the page and pick the run back up.
 */
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
  const validation = validateOptimizeBody(body, allowed, refineEnabled(env));
  if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: validation.status });
  const input = validation.value;

  const store = runStoreFor(env);
  const id = randomUUID();
  await store.save(newRunRecord(id, input));
  const client = describeClient(request.headers);
  after(() => executeRun(id, input, { env, store, client }));
  return NextResponse.json({ id, status: "running" }, { status: 202, headers: NO_STORE });
}

/** The run's current record: status, the steps so far, and the result or error once finished. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!isRunId(id)) return NextResponse.json({ error: "A run id is required." }, { status: 400 });
  const record = await runStoreFor(readServerEnv()).get(id);
  if (record === undefined) return NextResponse.json({ error: "This run is no longer available." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(record, { headers: NO_STORE });
}

/** Cancels a running run, or discards a finished one so its result leaves the store as soon as it was collected. */
export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!isRunId(id)) return NextResponse.json({ error: "A run id is required." }, { status: 400 });
  const store = runStoreFor(readServerEnv());
  const record = await store.get(id);
  if (record === undefined) return new Response(null, { status: 204 });
  if (record.status === "running") await store.requestCancel(id);
  else await store.delete(id);
  return new Response(null, { status: 204 });
}
