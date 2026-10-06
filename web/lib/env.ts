import "server-only";

export interface ServerEnv {
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly GOOGLE_GENERATIVE_AI_API_KEY?: string;
  readonly TYPESAFE_API_KEY?: string;
  readonly UPSTASH_REDIS_REST_URL?: string;
  readonly UPSTASH_REDIS_REST_TOKEN?: string;
  /** Test-only: serve canned completions and judge answers instead of calling providers. */
  readonly ARC_MOCK_PROVIDERS?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Reads the subset of `process.env` the app uses. Values are never logged. */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return {
    ANTHROPIC_API_KEY: clean(source.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: clean(source.OPENAI_API_KEY),
    GOOGLE_GENERATIVE_AI_API_KEY: clean(source.GOOGLE_GENERATIVE_AI_API_KEY),
    TYPESAFE_API_KEY: clean(source.TYPESAFE_API_KEY),
    UPSTASH_REDIS_REST_URL: clean(source.UPSTASH_REDIS_REST_URL ?? source.KV_REST_API_URL),
    UPSTASH_REDIS_REST_TOKEN: clean(source.UPSTASH_REDIS_REST_TOKEN ?? source.KV_REST_API_TOKEN),
    ARC_MOCK_PROVIDERS: clean(source.ARC_MOCK_PROVIDERS),
  };
}

/** Mock providers are a test fixture; they are never enabled in a Vercel production deployment. */
export function mockProvidersEnabled(env: ServerEnv, vercelEnv = process.env.VERCEL_ENV): boolean {
  return env.ARC_MOCK_PROVIDERS === "1" && vercelEnv !== "production";
}
