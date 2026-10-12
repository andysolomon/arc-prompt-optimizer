/**
 * Clerk credentials. Kept free of `server-only` because the middleware (edge runtime) and the root layout both read it.
 * The publishable key is public by design; the secret key never leaves the server.
 */
export interface ClerkKeys {
  readonly publishableKey?: string;
  readonly secretKey?: string;
}

export const SIGN_IN_PATH = "/sign-in";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Reads the two Clerk keys. Values are never logged. */
export function readClerkKeys(source: Record<string, string | undefined> = process.env): ClerkKeys {
  return {
    publishableKey: clean(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    secretKey: clean(source.CLERK_SECRET_KEY),
  };
}

/** Accounts are available only when both keys are set. Otherwise the provider, middleware, and sign-in controls are all left out. */
export function clerkEnabled(keys: ClerkKeys): keys is Required<ClerkKeys> {
  return keys.publishableKey !== undefined && keys.secretKey !== undefined;
}
