import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { clerkEnabled, readClerkKeys, SIGN_IN_PATH } from "@/lib/clerk-config";

export const metadata: Metadata = {
  title: "Sign in · Arc Prompt Optimizer",
};

const enabled = clerkEnabled(readClerkKeys());

export default function SignInPage() {
  return (
    <main data-testid="sign-in" className="mx-auto flex w-full max-w-[460px] flex-col items-center gap-6 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      {enabled ? (
        // One component handles both sign-in and first-time sign-up with Google or X.
        <SignIn path={SIGN_IN_PATH} routing="path" withSignUp />
      ) : (
        <div className="flex w-full flex-col gap-4">
          <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Sign in</h1>
          <p role="status" className="m-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Sign-in is not configured on this deployment. Set <code className="font-mono text-[13px]">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
            <code className="font-mono text-[13px]">CLERK_SECRET_KEY</code> to enable it.
          </p>
        </div>
      )}
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
        The optimizer, library, pattern catalog, and examples work without an account.{" "}
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to Optimize
        </Link>
      </p>
    </main>
  );
}
