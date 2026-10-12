import type { ServerEnv } from "@/lib/env";

export const AUTH_PROVIDER_IDS = ["google", "twitter"] as const;
export type AuthProviderId = (typeof AUTH_PROVIDER_IDS)[number];

export interface AuthProviderInfo {
  readonly id: AuthProviderId;
  /** Display name. X is still `twitter` to Auth.js; users see "X". */
  readonly name: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const PROVIDER_NAMES: Record<AuthProviderId, string> = { google: "Google", twitter: "X" };

export function providerName(id: AuthProviderId): string {
  return PROVIDER_NAMES[id];
}

export function isAuthProviderId(value: unknown): value is AuthProviderId {
  return typeof value === "string" && (AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** OAuth providers with both a client ID and secret set. A provider without credentials simply drops out of the sign-in page. */
export function configuredAuthProviders(env: ServerEnv): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push({ id: "google", name: PROVIDER_NAMES.google, clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET });
  }
  if (env.AUTH_TWITTER_ID && env.AUTH_TWITTER_SECRET) {
    providers.push({ id: "twitter", name: PROVIDER_NAMES.twitter, clientId: env.AUTH_TWITTER_ID, clientSecret: env.AUTH_TWITTER_SECRET });
  }
  return providers;
}

/** Accounts are available only with a cookie-signing secret and at least one configured provider. */
export function authEnabled(env: ServerEnv): boolean {
  return env.AUTH_SECRET !== undefined && configuredAuthProviders(env).length > 0;
}

/** Stable account identifier. The same person signing in with Google and with X gets two accounts; there is no database to link them. */
export function accountId(provider: string, providerAccountId: string): string {
  return `${provider}:${providerAccountId}`;
}

/**
 * Keeps post-sign-in redirects on this site. Accepts only an absolute path such as `/library?x=1`;
 * anything else (another origin, a protocol-relative `//host`, an empty value) falls back to `/`.
 */
export function safeCallbackPath(value: string | string[] | undefined, fallback = "/"): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2048) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\s]/u.test(candidate)) return fallback;
  return candidate;
}

/** User-facing text for the `error` query parameter Auth.js appends when it sends a visitor back to the sign-in page. */
export function signInErrorMessage(code: string | string[] | undefined): string | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return null;
  switch (value) {
    case "OAuthAccountNotLinked":
      return "This account is already linked to a different sign-in method.";
    case "AccessDenied":
      return "Access was denied. The provider did not authorize this sign-in.";
    case "OAuthCallbackError":
    case "OAuthSignin":
    case "OAuthCallback":
    case "Callback":
      return "The sign-in could not be completed. Try again.";
    case "Configuration":
      return "Sign-in is misconfigured on this deployment. Check the provider credentials and callback URL.";
    case "Verification":
      return "The sign-in link has expired or was already used.";
    default:
      return "Sign-in failed. Try again.";
  }
}
