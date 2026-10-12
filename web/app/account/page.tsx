import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountAvatar } from "@/components/auth/account-control";
import { Button } from "@/components/ui/button";
import { auth, authEnabled, signOut } from "@/lib/auth";
import { providerName } from "@/lib/auth-config";

export const metadata: Metadata = {
  title: "Account · Arc Prompt Optimizer",
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!authEnabled) redirect("/signin");
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Faccount");
  const { user } = session;
  const name = user.name?.trim() || "Account";

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Account</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          You are signed in{user.provider ? ` with ${providerName(user.provider)}` : ""}. Sessions last 30 days and are stored only in a signed
          cookie on this browser.
        </p>
      </div>

      <section aria-label="Profile" className="flex items-center gap-4 rounded-lg border border-border bg-card p-5">
        <AccountAvatar name={name} image={user.image} size={48} />
        <dl className="m-0 flex min-w-0 flex-col gap-1 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
            <dd className="m-0 truncate font-medium">{name}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
            <dd className="m-0 truncate">{user.email ?? <span className="text-muted-foreground">Not shared by {user.provider ? providerName(user.provider) : "the provider"}</span>}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Signed in with</dt>
            <dd className="m-0">{user.provider ? providerName(user.provider) : "Unknown"}</dd>
          </div>
        </dl>
      </section>

      <form
        action={async () => {
          "use server";
          await signOut("/");
        }}
      >
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
