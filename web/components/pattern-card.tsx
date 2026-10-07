import { Badge } from "@/components/ui/badge";
import type { PromptPattern } from "@/lib/types";

export function PatternCard({ pattern }: { pattern: PromptPattern }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[15px] font-semibold">{pattern.displayName}</h3>
        <code className="font-mono text-xs text-muted-foreground">{pattern.name}</code>
        <Badge variant="secondary" className="rounded-full px-[7px] py-px text-[11px] font-medium hover:bg-secondary">
          used in Optimize
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">temp {pattern.recommendedTemperature}</span>
      </div>
      <p className="m-0 text-sm leading-normal text-muted-foreground">{pattern.description}</p>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Variables">
        {pattern.variables.map((variable) => (
          <li key={variable}>
            <code className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">{variable}</code>
          </li>
        ))}
      </ul>
      <pre className="m-0 rounded-md border border-border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {pattern.template}
      </pre>
    </article>
  );
}
