"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { JevAnswer } from "@/lib/types";

/** Four-bar probability sparkline; the tooltip lists the level legend with each probability. */
export function JevSparkline({ answer }: { answer: JevAnswer }) {
  const levels = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b));
  const probabilities = levels.map((level) => answer.probabilities[level] ?? 0);
  const peak = Math.max(...probabilities);
  const description = levels.map((level, index) => `${level}: ${answer.legend[level]} — ${Math.round(probabilities[index]! * 100)}%`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Jev probability by level. ${description.join(". ")}`}
          className="flex h-[14px] items-end gap-[3px] rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {probabilities.map((p, index) => (
            <span
              key={levels[index]}
              aria-hidden="true"
              className={p === peak ? "block w-[18px] rounded-[2px] bg-foreground" : "block w-[18px] rounded-[2px] bg-border"}
              style={{ height: `${Math.max(2, Math.round(p * 14))}px` }}
            />
          ))}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <ol className="m-0 list-none space-y-0.5 p-0 tabular-nums">
          {description.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
  );
}
