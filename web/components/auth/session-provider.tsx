"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/** Client-side session cache for the header. Rendered only when sign-in is configured, so no session request is made otherwise. */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider basePath="/api/auth" refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
