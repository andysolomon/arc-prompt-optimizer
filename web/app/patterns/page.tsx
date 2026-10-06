import type { Metadata } from "next";
import { PatternCard } from "@/components/pattern-card";
import { listPatterns } from "@/lib/arc-core/core/index.js";

export const metadata: Metadata = {
  title: "Pattern catalog · Arc Prompt Optimizer",
};

export default function PatternsPage() {
  const patterns = listPatterns();
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Pattern catalog</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          Nine strict templates. Variable values are escaped before substitution, so a value cannot close a tag or quote delimiter. The preview
          run uses Critique, Decomposition, and Structured Reasoning.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {patterns.map((pattern) => (
          <PatternCard key={pattern.name} pattern={pattern} />
        ))}
      </div>
    </main>
  );
}
