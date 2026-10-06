"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCharacterCount } from "@/lib/format";
import { MAX_PROMPT_CHARACTERS, type ModelInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PromptForm({
  prompt,
  onPromptChange,
  models,
  modelsLoaded,
  model,
  onModelChange,
  judge,
  judgeAvailable,
  onJudgeChange,
  canRun,
  onRequestRun,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  models: readonly ModelInfo[];
  modelsLoaded: boolean;
  model: string;
  onModelChange: (value: string) => void;
  judge: boolean;
  judgeAvailable: boolean;
  onJudgeChange: (value: boolean) => void;
  canRun: boolean;
  onRequestRun: () => void;
}) {
  const overLimit = prompt.length > MAX_PROMPT_CHARACTERS;
  const noModels = modelsLoaded && models.length === 0;
  return (
    <form
      className="flex flex-col rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,.04)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (canRun) onRequestRun();
      }}
    >
      <div className="px-4 pt-4">
        <label htmlFor="prompt" className="mb-2 block text-sm font-medium">
          Prompt
        </label>
        <Textarea
          id="prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Summarize this incident report for executives."
          spellCheck={false}
          aria-describedby="prompt-count prompt-limit"
          aria-invalid={overLimit || undefined}
          className="min-h-[180px] resize-y rounded-lg border-border bg-background p-3 text-sm leading-relaxed md:text-sm"
        />
        <div className="mt-1.5 flex justify-between gap-3 text-xs text-muted-foreground">
          <span id="prompt-count" className={cn(overLimit && "text-destructive")} aria-live="polite">
            {formatCharacterCount(prompt.length)}
          </span>
          <span id="prompt-limit">Limit {MAX_PROMPT_CHARACTERS.toLocaleString("en-US")} characters</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border p-4">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <label htmlFor="model">Model</label>
          <Select value={model} onValueChange={onModelChange} disabled={models.length === 0}>
            <SelectTrigger id="model" className="h-9 min-w-[220px] text-sm text-foreground" aria-label="Model">
              <SelectValue placeholder={noModels ? "No providers configured" : modelsLoaded ? "Select a model" : "Loading models…"} />
            </SelectTrigger>
            <SelectContent>
              {models.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <JudgeSwitch judge={judge} available={judgeAvailable} onChange={onJudgeChange} />
        <Button type="submit" disabled={!canRun} className="ml-auto h-9 self-end px-4 text-sm">
          Optimize
        </Button>
      </div>
      {noModels ? (
        <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          No model providers are configured. Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY on the server.
        </p>
      ) : null}
    </form>
  );
}

function JudgeSwitch({ judge, available, onChange }: { judge: boolean; available: boolean; onChange: (value: boolean) => void }) {
  const control = (
    <div className={cn("flex h-9 items-center gap-2.5 self-end", !available && "opacity-60")}>
      <Switch
        id="judge"
        checked={available && judge}
        disabled={!available}
        onCheckedChange={onChange}
        aria-describedby="judge-description"
        className="h-5 w-9 data-[state=unchecked]:bg-border [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4"
      />
      <label htmlFor="judge" className="flex cursor-pointer flex-col items-start text-sm leading-tight">
        <span>Judge with Jev</span>
        <span id="judge-description" className="text-[11px] text-muted-foreground">
          TypeSafe Score question
        </span>
      </label>
    </div>
  );
  if (available) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {control}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Set TYPESAFE_API_KEY on the server to enable the Jev judge.
      </TooltipContent>
    </Tooltip>
  );
}
