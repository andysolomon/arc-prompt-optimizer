import { NextResponse } from "next/server";
import { mockProvidersEnabled, readServerEnv } from "@/lib/env";
import { MODELS, availableModels } from "@/lib/models";
import type { ModelsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const env = readServerEnv();
  const mock = mockProvidersEnabled(env);
  const body: ModelsResponse = {
    models: mock ? MODELS.map(({ id, label, provider }) => ({ id, label, provider })) : [...availableModels(process.env)],
    judgeAvailable: mock || env.TYPESAFE_API_KEY !== undefined,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
