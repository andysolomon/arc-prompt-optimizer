"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeControl } from "@/components/theme-control";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Optimize" },
  { href: "/patterns", label: "Patterns" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-[1040px] flex-wrap items-center gap-x-6 gap-y-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]" aria-label="Arc Prompt Optimizer home">
          <span aria-hidden="true" className="flex size-[22px] items-center justify-center rounded-md bg-primary">
            <span className="block size-2 rotate-45 rounded-[2px] bg-primary-foreground" />
          </span>
          <span className="whitespace-nowrap">Arc Prompt Optimizer</span>
        </Link>
        <nav aria-label="Primary" className="flex gap-1 text-sm">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl />
          <a
            href="https://github.com/andysolomon/arc-prompt-optimizer"
            target="_blank"
            rel="noreferrer"
            className="rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
