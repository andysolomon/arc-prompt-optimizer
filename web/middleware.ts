import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkEnabled, readClerkKeys } from "@/lib/clerk-config";

/**
 * Attaches the Clerk session to every request so `auth()` and the control components work. A no-op when Clerk is not configured.
 * Clerk reads `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` itself; passing them as options would need `CLERK_ENCRYPTION_KEY` too.
 */
export default clerkEnabled(readClerkKeys()) ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's proxied Frontend API path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
