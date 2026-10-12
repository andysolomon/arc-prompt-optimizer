"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { SavePromptButton } from "@/components/library/prompt-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DESIGN_GROUPS, type DesignExample } from "@/lib/design-examples";
import type { PATTERN_EXAMPLES } from "@/lib/pattern-examples";

interface ExampleCardProps {
  /** Anchor id and the identifier the Optimize page reads from the query string. */
  id: string;
  title: string;
  badge: string;
  description: string;
  prompt: string;
  /** Link that loads the prompt into Optimize without starting a run. */
  useHref: string;
  /** Accessible names for the copy and use controls, e.g. "Few-Shot Pattern example". */
  label: string;
  /** Shown as a "Save prompt" button that preselects this category in the editor. */
  saveCategory?: "design";
}

function ExampleCardBase({ id, title, badge, description, prompt, useHref, label, saveCategory }: ExampleCardProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <article id={id} className="flex scroll-mt-20 flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
        <Badge variant="secondary" className="rounded-full text-[11px] font-medium">{badge}</Badge>
      </div>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <pre className="m-0 rounded-md border border-border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          <Copy aria-hidden="true" />Copy
        </Button>
        {saveCategory ? <SavePromptButton prompt={prompt} title={title} category={saveCategory} /> : null}
        <Button asChild size="sm">
          <Link href={useHref} aria-label={`Use ${label}`}>Use this prompt</Link>
        </Button>
      </div>
    </article>
  );
}

export function ExampleCard({ example }: { example: (typeof PATTERN_EXAMPLES)[number] }) {
  return (
    <ExampleCardBase
      id={example.pattern}
      title={example.title}
      badge={example.displayName}
      description={example.description}
      prompt={example.prompt}
      useHref={`/?example=${example.pattern}`}
      label={`${example.displayName} example`}
    />
  );
}

export function DesignExampleCard({ example }: { example: DesignExample }) {
  return (
    <ExampleCardBase
      id={`design-${example.id}`}
      title={example.title}
      badge={DESIGN_GROUPS[example.group].label}
      description={example.description}
      prompt={example.prompt}
      useHref={`/?design=${example.id}`}
      label={`${example.title} design prompt`}
      saveCategory="design"
    />
  );
}
