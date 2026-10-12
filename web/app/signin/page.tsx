import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProviderIcon } from "@/components/auth/provider-icons";
import { Button } from "@/components/ui/button";
import { auth, authEnabled, authProviders, signIn } from "@/lib/auth";
import { safeCallbackPath, signInErrorMessage } from "@/lib/auth-config";

export const metadata: Metadata = {
  title: "Sign in · Arc Prompt Optimizer",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  const error = signInErrorMessage(params.error);

  if (authEnabled && (await auth())?.user) redirect(callbackUrl === "/signin" ? "/account" : callbackUrl);

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Sign in</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          Use your Google or X account. Signing in creates your account on the first visit; nothing else is stored.
        </p>
      </div>

      {error ? (
        <p role="alert" data-testid="signin-error" className="m-0 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {authEnabled ? (
        <div className="flex flex-col gap-3">
          {authProviders.map((provider) => (
            <form
              key={provider.id}
              action={async () => {
                "use server";
                await signIn(provider.id, callbackUrl);
              }}
            >
              <Button type="submit" variant="outline" size="lg" className="w-full justify-center gap-3 text-[15px]">
                <ProviderIcon id={provider.id} />
                Continue with {provider.name}
              </Button>
            </form>
          ))}
        </div>
      ) : (
        <p role="status" className="m-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Sign-in is not configured on this deployment. Set <code className="font-mono text-[13px]">AUTH_SECRET</code> and the Google or X client
          credentials to enable it.
        </p>
      )}

      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
        The optimizer, pattern catalog, and examples work without an account.{" "}
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to Optimize
        </Link>
      </p>
    </main>
  );
}
