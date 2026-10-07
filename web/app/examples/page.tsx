import type { Metadata } from "next";
import { ExampleCard } from "@/components/example-card";
import { PATTERN_EXAMPLES } from "@/lib/pattern-examples";

export const metadata: Metadata = { title: "Examples · Arc Prompt Optimizer" };

export default function ExamplesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Example prompts</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          A complete example for every pattern. Copy a prompt or load it into Optimize, then adapt it to your task before running.
        </p>
      </div>
      <nav aria-label="Example patterns" className="flex flex-wrap gap-2">
        {PATTERN_EXAMPLES.map((example) => (
          <a key={example.pattern} href={`#${example.pattern}`} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {example.displayName.replace(/ Pattern$/u, "")}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-4">
        {PATTERN_EXAMPLES.map((example) => <ExampleCard key={example.pattern} example={example} />)}
      </div>
    </main>
  );
}
