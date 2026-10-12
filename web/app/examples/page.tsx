import type { Metadata } from "next";
import { DesignExampleCard, ExampleCard } from "@/components/example-card";
import { DESIGN_EXAMPLES, DESIGN_GROUPS, type DesignGroup } from "@/lib/design-examples";
import { PATTERN_EXAMPLES } from "@/lib/pattern-examples";

export const metadata: Metadata = { title: "Examples · Arc Prompt Optimizer" };

const NAV_LINK = "rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function ExamplesPage() {
  const groups = (Object.keys(DESIGN_GROUPS) as DesignGroup[]).filter((group) => DESIGN_EXAMPLES.some((example) => example.group === group));
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.025em]">Example prompts</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          A complete example for every pattern, plus a catalog of design briefs for image models. Copy a prompt, save it to your library, or load it into
          Optimize, then adapt it to your task before running.
        </p>
      </div>
      <nav aria-label="Example sections" className="flex flex-wrap gap-2">
        <a href="#patterns" className={NAV_LINK}>Patterns</a>
        <a href="#design" className={NAV_LINK}>Design</a>
      </nav>

      <section id="patterns" aria-labelledby="patterns-heading" className="flex scroll-mt-20 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="patterns-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">Pattern examples</h2>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">One task-specific prompt rendered through each catalog pattern, exactly as Optimize renders them.</p>
        </div>
        <nav aria-label="Example patterns" className="flex flex-wrap gap-2">
          {PATTERN_EXAMPLES.map((example) => (
            <a key={example.pattern} href={`#${example.pattern}`} className={NAV_LINK}>
              {example.displayName.replace(/ Pattern$/u, "")}
            </a>
          ))}
        </nav>
        <div className="flex flex-col gap-4">
          {PATTERN_EXAMPLES.map((example) => <ExampleCard key={example.pattern} example={example} />)}
        </div>
      </section>

      <section id="design" aria-labelledby="design-heading" className="flex scroll-mt-20 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="design-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">Design prompts</h2>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            Briefs written for image models such as Nano Banana Pro. Each one names the subject, composition, materials, palette, and strict exclusions, then
            the output size. Replace the [BRACKETED] placeholders and leave the rest. Running one through Optimize tightens the wording; the image itself
            still comes from your image model.
          </p>
        </div>
        <nav aria-label="Design groups" className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <a key={group} href={`#design-group-${group}`} className={NAV_LINK}>{DESIGN_GROUPS[group].label}</a>
          ))}
        </nav>
        {groups.map((group) => (
          <div key={group} id={`design-group-${group}`} className="flex scroll-mt-20 flex-col gap-3">
            <div className="flex flex-col gap-1 pt-2">
              <h3 className="m-0 text-base font-semibold">{DESIGN_GROUPS[group].label}</h3>
              <p className="m-0 text-sm text-muted-foreground">{DESIGN_GROUPS[group].description}</p>
            </div>
            {DESIGN_EXAMPLES.filter((example) => example.group === group).map((example) => <DesignExampleCard key={example.id} example={example} />)}
          </div>
        ))}
      </section>
    </main>
  );
}
