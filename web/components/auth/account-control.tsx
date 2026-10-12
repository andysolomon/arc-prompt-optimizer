"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

const linkClass =
  "rounded-md text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AccountAvatar({ name, image, size = 24 }: { name: string | null | undefined; image: string | null | undefined; size?: number }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={size}
        height={size}
        unoptimized
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full bg-muted object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initial}
    </span>
  );
}

/** Header control: "Sign in" when signed out, the account avatar linking to /account when signed in. */
export function AccountControl() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  if (status === "loading") {
    return <span aria-hidden="true" className="inline-block h-6 w-14 rounded-md bg-muted/60" />;
  }
  if (!session?.user) {
    const callback = pathname && pathname !== "/signin" ? `?callbackUrl=${encodeURIComponent(pathname)}` : "";
    return (
      <Link href={`/signin${callback}`} className={cn(linkClass, "font-medium text-foreground hover:text-foreground/80")}>
        Sign in
      </Link>
    );
  }
  const label = session.user.name?.trim() || "Account";
  return (
    <Link
      href="/account"
      aria-label={`Account: ${label}`}
      aria-current={pathname === "/account" ? "page" : undefined}
      className={cn(linkClass, "flex items-center gap-2 text-muted-foreground hover:text-foreground")}
    >
      <AccountAvatar name={label} image={session.user.image} />
      <span className="hidden max-w-[12rem] truncate sm:inline">{label}</span>
    </Link>
  );
}
