import { NextResponse } from "next/server";
import { mockProvidersEnabled, readServerEnv } from "@/lib/env";
import { categorizeRequestSchema, categorizeWithJev } from "@/lib/jev-categorize";
import { clientIp, rateLimiterFor, rateLimitMessage } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const env = readServerEnv();
  const mocked = mockProvidersEnabled(env);
  if (!mocked && !env.TYPESAFE_API_KEY) {
    return NextResponse.json({ error: "Jev categorization is unavailable. Choose a category manually." }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const parsed = categorizeRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Prompt must be non-empty and at most 48,000 characters." }, { status: 400 });
  const limit = await rateLimiterFor(env, "categorize").limit(clientIp(request.headers));
  if (!limit.success) return NextResponse.json({ error: rateLimitMessage(limit, "category suggestions") }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } });
  if (mocked) return NextResponse.json({ category: "writing", confidence: 0.92, model: "jev-mock" });
  try {
    return NextResponse.json(await categorizeWithJev(parsed.data.prompt, { apiKey: env.TYPESAFE_API_KEY!, signal: request.signal }));
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: "Jev could not categorize this prompt. Try again or choose a category manually." }, { status: 502 });
  }
}
