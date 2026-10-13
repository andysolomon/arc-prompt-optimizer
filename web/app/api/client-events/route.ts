import { NextResponse } from "next/server";
import { MAX_CLIENT_EVENT_BYTES, clientEventSchema } from "@/lib/client-events";
import { describeClient } from "@/lib/client-info";
import { readServerEnv } from "@/lib/env";
import { clientIp, rateLimiterFor } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts one run outcome the browser observed and writes it to the runtime log as `arc.client.<event>`, at error
 * level so Vercel's error aggregation keeps it alongside `arc.run.failed`, with the same coarse client description
 * the run logs carry. The body is validated against a closed schema and never contains prompt content. Anything
 * malformed is dropped with a 204 too: the page fires and forgets, and a reply would not help it.
 */
export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimiterFor(readServerEnv(), "client_events").limit(clientIp(request.headers));
  if (!limit.success) return new Response(null, { status: 429 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_CLIENT_EVENT_BYTES) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_CLIENT_EVENT_BYTES) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = clientEventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid event." }, { status: 400 });
  const { event, ...fields } = parsed.data;
  console.error(JSON.stringify({ ts: new Date().toISOString(), source: "arc-prompt-optimizer", event: `arc.client.${event}`, client: describeClient(request.headers), ...fields }));
  return new Response(null, { status: 204 });
}
