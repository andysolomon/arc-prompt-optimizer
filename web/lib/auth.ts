import "server-only";
import NextAuth, { type NextAuthConfig, type NextAuthResult, type Session } from "next-auth";
import Google from "next-auth/providers/google";
import Twitter from "next-auth/providers/twitter";
import { accountId, authEnabled as enabledFor, configuredAuthProviders, isAuthProviderId, type AuthProviderInfo } from "@/lib/auth-config";
import { readServerEnv } from "@/lib/env";

const env = readServerEnv();

/** True when `AUTH_SECRET` and at least one provider's credentials are set. Everything auth-related is hidden otherwise. */
export const authEnabled: boolean = enabledFor(env);

/** Providers shown on the sign-in page, in display order. */
export const authProviders: readonly AuthProviderInfo[] = configuredAuthProviders(env);

function buildConfig(): NextAuthConfig {
  return {
    secret: env.AUTH_SECRET,
    // Stateless JWT sessions: there is no database. The session carries the provider and a provider-scoped account id.
    session: { strategy: "jwt" },
    pages: { signIn: "/signin", error: "/signin" },
    providers: authProviders.map((provider) =>
      provider.id === "google"
        ? Google({ clientId: provider.clientId, clientSecret: provider.clientSecret })
        : Twitter({ clientId: provider.clientId, clientSecret: provider.clientSecret }),
    ),
    callbacks: {
      jwt({ token, account }) {
        if (account && isAuthProviderId(account.provider)) {
          token.sub = accountId(account.provider, account.providerAccountId);
          token.provider = account.provider;
        }
        return token;
      },
      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        if (isAuthProviderId(token.provider)) session.user.provider = token.provider;
        return session;
      },
    },
  };
}

const nextAuth: NextAuthResult | null = authEnabled ? NextAuth(buildConfig()) : null;

/** Auth.js route handlers. `null` when sign-in is not configured; the route returns 404 then. */
export const handlers = nextAuth?.handlers ?? null;

/** Current session, or `null` when signed out or when sign-in is not configured. */
export async function auth(): Promise<Session | null> {
  if (!nextAuth) return null;
  return nextAuth.auth();
}

/** Starts the OAuth flow for `provider`, then returns the visitor to `redirectTo`. Server-action only. */
export async function signIn(provider: string, redirectTo: string): Promise<void> {
  if (!nextAuth) throw new Error("Sign-in is not configured.");
  await nextAuth.signIn(provider, { redirectTo });
}

/** Clears the session cookie and sends the visitor to `redirectTo`. Server-action only. */
export async function signOut(redirectTo = "/"): Promise<void> {
  if (!nextAuth) return;
  await nextAuth.signOut({ redirectTo });
}
