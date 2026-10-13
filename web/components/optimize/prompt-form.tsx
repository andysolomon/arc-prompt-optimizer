"use client";

import { useState } from "react";
import { ChevronDown, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SavePromptButton } from "@/components/library/prompt-editor-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCharacterCount } from "@/lib/format";
import { MAX_PROMPT_CHARACTERS, MAX_REWRITE_DETAIL_CHARACTERS, REFINE_DEFAULT_ROUNDS, REFINE_DEFAULT_VARIANTS, type ModelInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PromptForm({
  prompt,
  onPromptChange,
  context,
  onContextChange,
  useCase,
  onUseCaseChange,
  models,
  modelsLoaded,
  model,
  onModelChange,
  judge,
  judgeAvailable,
  onJudgeChange,
  refine,
  refineAvailable,
  onRefineChange,
  canRun,
  canClear,
  onClear,
  onRequestRun,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  context: string;
  onContextChange: (value: string) => void;
  useCase: string;
  onUseCaseChange: (value: string) => void;
  models: readonly ModelInfo[];
  modelsLoaded: boolean;
  model: string;
  onModelChange: (value: string) => void;
  judge: boolean;
  judgeAvailable: boolean;
  onJudgeChange: (value: boolean) => void;
  refine: boolean;
  /** The server flag is on; the switch is still disabled until the judge is on. */
  refineAvailable: boolean;
  onRefineChange: (value: boolean) => void;
  canRun: boolean;
  /** Something to clear and no run in progress. */
  canClear: boolean;
  /** Clears the prompt, the rewrite details, and the previous result. */
  onClear: () => void;
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="prompt" className="block text-sm font-medium">
            Prompt
          </label>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-[13px]" disabled={!canClear} onClick={onClear} aria-label="New prompt">
              <Eraser aria-hidden="true" className="size-3.5" />
              New prompt
            </Button>
            <SavePromptButton prompt={prompt} />
          </div>
        </div>
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
        <RewriteDetails context={context} onContextChange={onContextChange} useCase={useCase} onUseCaseChange={onUseCaseChange} />
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
        {refineAvailable ? <RefineSwitch refine={refine} available={judgeAvailable && judge} onChange={onRefineChange} /> : null}
        <Button type="submit" disabled={!canRun} className="ml-auto h-9 self-end px-4 text-sm">
          Optimize
        </Button>
      </div>
      {noModels ? (
        <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          No model providers are configured. Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, MINIMAX_API_KEY, or
          OPENCODE_API_KEY on the server.
        </p>
      ) : null}
    </form>
  );
}

function RefineSwitch({ refine, available, onChange }: { refine: boolean; available: boolean; onChange: (value: boolean) => void }) {
  const control = (
    <div className={cn("flex h-9 items-center gap-2.5 self-end", !available && "opacity-60")}>
      <Switch
        id="refine"
        checked={available && refine}
        disabled={!available}
        onCheckedChange={onChange}
        aria-describedby="refine-description"
        className="h-5 w-9 data-[state=unchecked]:bg-border [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4"
      />
      <label htmlFor="refine" className="flex cursor-pointer flex-col items-start text-sm leading-tight">
        <span>Refine</span>
        <span id="refine-description" className="text-[11px] text-muted-foreground">
          {REFINE_DEFAULT_ROUNDS} rounds of {REFINE_DEFAULT_VARIANTS} revisions on Jev feedback
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
        Turn on the Jev judge to refine: without it every preview candidate ties.
      </TooltipContent>
    </Tooltip>
  );
}

/** Optional task context and target use case from the reference protocol; the rewrite uses them to pick role, audience, and format. */
function RewriteDetails({
  context,
  onContextChange,
  useCase,
  onUseCaseChange,
}: {
  context: string;
  onContextChange: (value: string) => void;
  useCase: string;
  onUseCaseChange: (value: string) => void;
}) {
  const filled = context.trim() !== "" || useCase.trim() !== "";
  const [open, setOpen] = useState(filled);
  return (
    <Collapsible open={open || filled} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", (open || filled) && "rotate-180")} />
          Rewrite details (optional)
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <DetailField
            id="rewrite-context"
            label="Task context"
            hint="Where the prompt runs and what it works on."
            placeholder="Incident reports arrive as PagerDuty markdown with a timeline and an impact section."
            value={context}
            onChange={onContextChange}
          />
          <DetailField
            id="rewrite-use-case"
            label="Target use case"
            hint="What the output is for and who reads it."
            placeholder="A weekly email to executives who skim on their phones."
            value={useCase}
            onChange={onUseCaseChange}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DetailField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const overLimit = value.length > MAX_REWRITE_DETAIL_CHARACTERS;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        aria-describedby={`${id}-hint`}
        aria-invalid={overLimit || undefined}
        className="min-h-[72px] resize-y rounded-lg border-border bg-background p-2.5 text-sm leading-relaxed md:text-sm"
      />
      <span id={`${id}-hint`} className={cn("text-[11px] text-muted-foreground", overLimit && "text-destructive")}>
        {overLimit ? `Over the ${MAX_REWRITE_DETAIL_CHARACTERS.toLocaleString("en-US")} character limit.` : hint}
      </span>
    </div>
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
