import type { AuthProviderId } from "@/lib/auth-config";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      /** `provider:providerAccountId`; stable for one person on one provider. */
      id: string;
      provider?: AuthProviderId;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: AuthProviderId;
  }
}
