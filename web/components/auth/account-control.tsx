"use client";

import { ClerkLoaded, ClerkLoading, Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIGN_IN_PATH } from "@/lib/clerk-config";

/** Header control: "Sign in" when signed out, Clerk's user button (account menu and sign out) when signed in. */
export function AccountControl() {
  const pathname = usePathname();
  const redirect = pathname && pathname !== SIGN_IN_PATH ? `?redirect_url=${encodeURIComponent(pathname)}` : "";
  return (
    <div className="flex h-7 items-center" data-testid="account-control">
      <ClerkLoading>
        <span aria-hidden="true" data-testid="account-loading" className="inline-block h-6 w-14 rounded-md bg-muted/60" />
      </ClerkLoading>
      <ClerkLoaded>
        <Show when="signed-out">
          <Link
            href={`${SIGN_IN_PATH}${redirect}`}
            className="rounded-md text-[13px] font-medium text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </ClerkLoaded>
    </div>
  );
}
