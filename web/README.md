# Arc Prompt Optimizer · web

Web frontend for [arc-prompt-optimizer](https://github.com/andysolomon/arc-prompt-optimizer). Paste a prompt, pick a model, confirm, and the app renders the baseline plus three pattern variants (critique, decomposition, structured reasoning), runs one completion per candidate, scores the outputs with the core's deterministic checks, optionally asks TypeSafe's Jev one Score question per candidate, and ranks the result. Nothing calls a model until you confirm, and prompts and outputs are never logged, persisted, or submitted anywhere other than the provider you chose.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandysolomon%2Farc-prompt-optimizer&root-directory=web&project-name=arc-prompt-optimizer&repository-name=arc-prompt-optimizer&env=ANTHROPIC_API_KEY,OPENAI_API_KEY,GOOGLE_GENERATIVE_AI_API_KEY,TYPESAFE_API_KEY&envDescription=Provider%20keys%20are%20optional%3B%20set%20any%20subset.&envLink=https%3A%2F%2Fgithub.com%2Fandysolomon%2Farc-prompt-optimizer%2Fblob%2Fmain%2Fweb%2FREADME.md%23environment)

## Stack

Next.js 15 (App Router, TypeScript, Node route handlers), Tailwind CSS v4, shadcn/ui (zinc), Geist Sans and Geist Mono via `geist`, `next-themes`, Vercel AI SDK (`ai` with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`), Zod, `@upstash/ratelimit`, Vitest, Playwright. Package manager is pnpm; Node 22 or newer.

## Setup

```sh
cd web
pnpm install
cp .env.example .env.local   # fill in the keys you have
pnpm dev                     # http://localhost:3000
```

Checks:

```sh
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint, zero warnings allowed
pnpm test          # Vitest: adapter mapping, Jev normalization, lineDiffSummary, route validation, run orchestration
pnpm test:e2e      # Playwright smoke test with mocked providers (runs `next dev` on port 3100)
pnpm build         # next build
```

The first Playwright run needs a browser: `pnpm exec playwright install chromium`.

## Environment

| Variable | Purpose |
| - | - |
| `ANTHROPIC_API_KEY` | Enables Claude Sonnet 4.5 and Claude Haiku 4.5. |
| `OPENAI_API_KEY` | Enables GPT-5 mini. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Enables Gemini 2.5 Flash. |
| `TYPESAFE_API_KEY` | Enables the "Judge with Jev" switch. Without it the switch is disabled with a tooltip. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional shared store for the per-IP rate limit (`KV_REST_API_URL` / `KV_REST_API_TOKEN` from Vercel KV are accepted too). Without them the limit lives in process memory, per instance. |
| `ARC_MOCK_PROVIDERS` | Test-only. `1` serves canned completions and judge answers. Ignored when `VERCEL_ENV=production`. |

The app starts with any subset of keys. `GET /api/models` returns only the models whose provider key is present; the model select is populated from it.

## Deploy on Vercel

1. Import the repository and set **Root Directory** to `web`. The deploy button above does this for you.
2. Add the environment variables you have.
3. `/api/optimize` declares `maxDuration = 300`. Four sequential completions at up to 60 s each plus one judge call can exceed a minute, so enable [Fluid compute](https://vercel.com/docs/fluid-compute) or use a Pro plan. On the Hobby plan functions are capped at 60 s and long runs will be cut off.

`vercel.json` only pins the install and build commands; no rewrites or custom routing are needed.

## API

### `POST /api/optimize`

Body: `{ "prompt": string, "model": string, "judge": boolean }`. The prompt must be non-empty and at most 16,384 characters; the model must be one of `anthropic/claude-sonnet-4-5`, `anthropic/claude-haiku-4-5`, `openai/gpt-5-mini`, `google/gemini-2.5-flash` and its provider key must be configured. Invalid requests return 400 with `{ "error": string }`; the per-IP limit of 10 runs per 10 minutes returns 429.

With `Accept: text/event-stream` the route streams Server-Sent Events, one per completed step (`render`, `run:<candidateId>` ×4, `judge` when requested, `rank`), then a final `result` event. Without that header it returns the same result as a JSON body. The result is `{ baselineCandidateId, candidates, evaluations, ranking, judge, completionsUsed, model }`, where `candidates`, `evaluations`, and `ranking` are the core library's `PromptCandidate[]`, `CandidateEvaluation[]`, and `RankedCandidate[]`.

Each completion runs through the Vercel AI SDK with a 60 s timeout and is aborted when the client disconnects. `latencyMs`, `usage.inputTokens`, and `usage.outputTokens` are recorded from the provider response; `costUsd` is computed from the list prices in `lib/pricing.ts` only when both token counts are known and is otherwise left unknown (shown as `n/a`), never reported as 0.

When `judge` is true the route makes one request to `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`. The request `state` holds every candidate's `{ prompt, output }` pair, and one Score question per candidate asks "How well does the output fulfil the task in the prompt?" over the four levels *Off-task or empty*, *Addresses the task but incomplete or vague*, *Complete and accurate, some loose ends*, *Complete, accurate, and clearly organized* (each question names the pair it should judge). The returned `score` is divided by 3 and fed to the core as the judge score with the objective `{ deterministicWeight: 1, judgeWeight: 1, tieBreakers: ["totalTokens", "latencyMs", "costUsd"] }`. The raw `score`, `confidence`, `probabilities`, and `legend` are kept under `judge.answers[candidateId]`. If TypeSafe fails, the response carries the deterministic ranking and `judge: { status: "failed", reason }`.

### `GET /api/models`

`{ models: [{ id, label, provider }], judgeAvailable: boolean }`, filtered to providers whose key is present.

## Core logic

The web app reuses the repository's core instead of reimplementing it: `buildPreviewCandidates`, `PREVIEW_SUITE`, `evaluateSuite`, `aggregateCases`, `rankCandidates`, `DEFAULT_RANKING_OBJECTIVE`, and `listPatterns` all come from `lib/arc-core`.

`lib/arc-core` is a verbatim copy of `src/core/*` and `src/adapters/completion.ts` rather than a package dependency. The published package's entry point re-exports the Pi completion adapter, which drags the whole Pi coding agent into the server bundle, and `dist/` is not committed, so a `github:` dependency cannot be built during a Vercel install. Only `lib/arc-core/adapters/index.ts` differs from the repository: it omits the Pi adapter export. `pnpm sync:arc-core` refreshes the copy, `pnpm check:arc-core` verifies it is byte-identical, and `tests/unit/arc-core-sync.test.ts` runs that check whenever the repository source is present.

`lineDiffSummary` is ported unchanged from `src/extension/review.ts` into `lib/diff.ts` because that module imports Pi types.

## Privacy

Prompts and model outputs stay in memory for the duration of a request. The server never logs, stores, or forwards them except to the provider you selected and, when enabled, to TypeSafe for judging. There is no analytics on prompt content. The browser keeps the last prompt and result in `sessionStorage` so a refresh does not lose them; closing the tab clears it.

## Scores

The preview suite only checks that each output is non-empty, so every candidate passes 1/1 and deterministic scores tie at 1.00. Ties are broken by total tokens, then latency, then cost. The Jev score is a Score question over four levels, normalized and averaged with the deterministic score; its confidence reflects how spread the probability is across levels, not whether the answer is correct. Supply an evaluation suite through the core library for a meaningful comparison.
