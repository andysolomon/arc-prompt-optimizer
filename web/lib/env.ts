import "server-only";

export interface ServerEnv {
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly GOOGLE_GENERATIVE_AI_API_KEY?: string;
  readonly MINIMAX_API_KEY?: string;
  readonly OPENCODE_API_KEY?: string;
  readonly TYPESAFE_API_KEY?: string;
  readonly UPSTASH_REDIS_REST_URL?: string;
  readonly UPSTASH_REDIS_REST_TOKEN?: string;
  /** Signs session cookies. Sign-in is disabled when absent. */
  readonly AUTH_SECRET?: string;
  readonly AUTH_GOOGLE_ID?: string;
  readonly AUTH_GOOGLE_SECRET?: string;
  /** X (formerly Twitter) OAuth 2.0 client credentials. */
  readonly AUTH_TWITTER_ID?: string;
  readonly AUTH_TWITTER_SECRET?: string;
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
    MINIMAX_API_KEY: clean(source.MINIMAX_API_KEY),
    OPENCODE_API_KEY: clean(source.OPENCODE_API_KEY),
    TYPESAFE_API_KEY: clean(source.TYPESAFE_API_KEY),
    UPSTASH_REDIS_REST_URL: clean(source.UPSTASH_REDIS_REST_URL ?? source.KV_REST_API_URL),
    UPSTASH_REDIS_REST_TOKEN: clean(source.UPSTASH_REDIS_REST_TOKEN ?? source.KV_REST_API_TOKEN),
    AUTH_SECRET: clean(source.AUTH_SECRET),
    AUTH_GOOGLE_ID: clean(source.AUTH_GOOGLE_ID),
    AUTH_GOOGLE_SECRET: clean(source.AUTH_GOOGLE_SECRET),
    AUTH_TWITTER_ID: clean(source.AUTH_TWITTER_ID),
    AUTH_TWITTER_SECRET: clean(source.AUTH_TWITTER_SECRET),
    ARC_MOCK_PROVIDERS: clean(source.ARC_MOCK_PROVIDERS),
  };
}

/** Mock providers are a test fixture; they are never enabled in a Vercel production deployment. */
export function mockProvidersEnabled(env: ServerEnv, vercelEnv = process.env.VERCEL_ENV): boolean {
  return env.ARC_MOCK_PROVIDERS === "1" && vercelEnv !== "production";
}
