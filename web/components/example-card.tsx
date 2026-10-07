"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PATTERN_EXAMPLES } from "@/lib/pattern-examples";

export function ExampleCard({ example }: { example: (typeof PATTERN_EXAMPLES)[number] }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(example.prompt);
      toast("Copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <article id={example.pattern} className="flex scroll-mt-20 flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[15px] font-semibold">{example.title}</h2>
        <Badge variant="secondary" className="rounded-full text-[11px] font-medium">{example.displayName}</Badge>
      </div>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">{example.description}</p>
      <pre className="m-0 rounded-md border border-border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{example.prompt}</pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()} aria-label={`Copy ${example.displayName} example`}>
          <Copy aria-hidden="true" />Copy
        </Button>
        <Button asChild size="sm">
          <Link href={`/?example=${example.pattern}`} aria-label={`Use ${example.displayName} example`}>Use this prompt</Link>
        </Button>
      </div>
    </article>
  );
}
