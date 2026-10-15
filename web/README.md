# Arc Prompt Optimizer · web

Web frontend for [arc-prompt-optimizer](https://github.com/andysolomon/arc-prompt-optimizer). Paste a prompt, attach up to three images for models that take them, pick a model, confirm, and the model first rewrites your prompt with a role, an explicit format, constraints, and examples, and plans how any answer to it should be judged: the task type, a suggested temperature, objective checks (word limit, format, required keywords, forbidden phrases), and up to three catalog patterns worth trying for that kind of task. The app renders the baseline, the rewrite, and those pattern variants, runs one completion per candidate, scores every output against the planned checks, and, while the rewrite's output still fails a check and time allows, asks the model to revise the prompt for the failed checks and runs the revision, up to two rounds. Optionally it asks TypeSafe's Jev one Score question per candidate, then ranks everything. Optimization calls a model only after confirmation, runs on the server independently of the browser connection, and is picked back up when you return to the page. Save prompts in the browser's Library and explicitly request Jev category suggestions when needed. The server never logs or persists prompt content.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandysolomon%2Farc-prompt-optimizer&root-directory=web&project-name=arc-prompt-optimizer&repository-name=arc-prompt-optimizer&env=ANTHROPIC_API_KEY,OPENAI_API_KEY,GOOGLE_GENERATIVE_AI_API_KEY,TYPESAFE_API_KEY&envDescription=Provider%20keys%20are%20optional%3B%20set%20any%20subset.&envLink=https%3A%2F%2Fgithub.com%2Fandysolomon%2Farc-prompt-optimizer%2Fblob%2Fmain%2Fweb%2FREADME.md%23environment)

The Examples tab contains a complete, copyable prompt for each catalog pattern, and a catalog of design prompts written for image models such as Nano Banana Pro, grouped into brand identity, branded products, 3D objects, posters and illustration, icons and stickers, mockups, apparel, and typography. Every design prompt follows the same structure: a one-line brief, labelled sections for the main element, composition, materials, and palette, a STRICT section of exclusions, and an OUTPUT line with the aspect ratio. Only the `[BRACKETED]` placeholders are meant to change. “Use this prompt” loads any example into Optimize for editing without starting a model run; “Save prompt” on a design prompt opens the library editor with the Design category preselected. The design catalog's grouping follows AmirMušić's public [50 design prompts](https://x.com/AmirMushich/status/2019073081881293302) catalog; the prompt text in `lib/design-examples.ts` is original.

## Saved prompts

“Save prompt” on the draft or selected candidate opens an editor for the title, exact prompt text, and category. The Library tab also lets you create prompts, search titles and text, filter by category, copy, edit, delete, and load prompts into Optimize without starting a run. Library prompts live in `localStorage` on this browser and origin and survive closing a tab. They are not shared between devices or synced to an account, even when you are signed in. Export a JSON backup and import it in another browser; imports add missing IDs and preserve existing local records. The library supports up to 500 prompts, each at most 48,000 characters, subject to browser storage capacity. Optimize accepts up to 16,384 characters, so longer saved candidates can be copied or shortened in Edit.

With `TYPESAFE_API_KEY` configured, “Suggest with Jev” sends only the editor's prompt text to TypeSafe. A [Choice question](https://docs.typesafe.ai/primitives/choice) selects Coding, Writing, Research, Summarization, Analysis, Planning, Creative, Design, or Other. The category and confidence are shown for review before saving. You can change the category manually; Jev failures never prevent a manual save. Clearing browser site data removes the library, so use Export for backups.

## Stack

Next.js 15 (App Router, TypeScript, Node route handlers), Tailwind CSS v4, shadcn/ui (zinc), Geist Sans and Geist Mono via `geist`, `next-themes`, Vercel AI SDK (`ai` with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`), Zod, `@upstash/ratelimit`, Clerk (`@clerk/nextjs`) for accounts, Vitest, Playwright. Package manager is pnpm; Node 22 or newer.

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
pnpm test          # Vitest: adapter mapping, Jev normalization, lineDiffSummary, route validation, run orchestration, background runs, run logging, client events
pnpm test:e2e      # Playwright smoke test with mocked providers (runs `next dev` on port 3100)
pnpm build         # next build
```

The first Playwright run needs a browser: `pnpm exec playwright install chromium`. Where a Chromium is already installed, set `PLAYWRIGHT_CHROMIUM_PATH` to its executable instead.

## Environment

| Variable | Purpose |
| - | - |
| `ANTHROPIC_API_KEY` | Enables Claude Sonnet 4.5 and Claude Haiku 4.5. |
| `OPENAI_API_KEY` | Enables GPT-5 mini. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Enables Gemini 2.5 Flash. |
| `MINIMAX_API_KEY` | MiniMax platform or Coding Plan key. Enables MiniMax M3 and MiniMax M2.7 through `https://api.minimax.io/v1`. |
| `OPENCODE_API_KEY` | OpenCode Go subscription key. Enables DeepSeek V4 Pro, GLM-5.3, Kimi K2.6, and Qwen3.7 Plus through `https://opencode.ai/zen/go/v1`. |
| `TYPESAFE_API_KEY` | Enables the "Judge with Jev" switch and Library category suggestions. Manual saving and categorization work without it. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared store for background runs and the per-IP rate limit (`KV_REST_API_URL` / `KV_REST_API_TOKEN` from Vercel KV are accepted too). Without them both live in process memory, per instance; on a multi-instance deployment a run can then be lost to a poll that lands elsewhere. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Enable accounts through [Clerk](https://clerk.com). Both are required; with either missing, sign-in is hidden and the Clerk middleware is a no-op. |
| `ARC_MOCK_PROVIDERS` | Test-only. `1` serves canned completions and judge answers. Ignored when `VERCEL_ENV=production`. |
| `ARC_REFINE_ENABLED` | Feature flag. `1` shows the Refine switch and accepts `refine` on `/api/optimize`. Off by default; see [The refine loop](#the-refine-loop). |

The app starts with any subset of keys. `GET /api/models` returns only the models whose provider key is present; the model select is populated from it.

## Accounts

Visitors can sign in with a Google or an X account through [Clerk](https://clerk.com). The header shows **Sign in** when signed out and Clerk's user button, with account management and sign-out, when signed in. `/sign-in` hosts Clerk's prebuilt `<SignIn>` component in combined mode, so a first visit with Google or X creates the account and later visits sign in to it. Clerk stores the users; the app has no database and keeps no user data of its own. Pages stay statically rendered: the auth state is resolved on the client, and the `clerkMiddleware` in `middleware.ts` attaches the session to every request so `auth()` works in route handlers and server components when a feature needs it. The optimizer, library, pattern catalog, and examples do not require an account.

Accounts appear only when both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set. To configure them:

1. In the [Clerk dashboard](https://dashboard.clerk.com), open your application and copy both keys from **API keys** into `.env.local` (and into Vercel for a deployment).
2. Under **User & authentication → Social connections**, enable **Google** and **X / Twitter**. Development instances can use Clerk's shared OAuth credentials; a production instance needs your own OAuth client for each provider and a verified domain. Clerk's dashboard shows the callback URL to register with each provider.
3. Optionally turn off other sign-in methods there so the sign-in card shows only the two social buttons.

Clerk's prebuilt components are styled through the `shadcn` theme from `@clerk/ui/themes`, which reads this app's CSS variables and so follows light and dark mode. The Clerk SDK collects telemetry on development instances; set `CLERK_TELEMETRY_DISABLED=1` to opt out.

## Deploy on Vercel

1. Import the repository and set **Root Directory** to `web`. The deploy button above does this for you.
2. Add the environment variables you have. For accounts, add the two Clerk keys; a production Clerk instance also needs the deployment's domain configured in the Clerk dashboard, while a development instance works on any hostname, including preview deployments.
3. `/api/optimize` and `/api/optimize/runs` declare `maxDuration = 300`. A run is one rewrite completion, then up to five candidate completions in parallel, then up to two revision rounds (a revise completion and the revision's run each), then one judge call, so it routinely takes longer than a minute. The first round runs within a 240 s budget that leaves room for the judge call, and revision rounds are attempted only while they fit it. Enable [Fluid compute](https://vercel.com/docs/fluid-compute) or use a Pro plan; without it, Hobby functions are capped at 60 s and long runs are cut off.
4. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or attach Vercel KV). The web UI starts every optimization as a background run (see [`/api/optimize/runs`](#post-apioptimizeruns)) and polls it, so a phone that switches apps, a dropped connection, or a reload does not end the run. The run's record lives in Redis; without it, records are kept in the memory of the instance that started the run, and a poll routed to another instance finds nothing and reports "This run is no longer available." Local development has one instance, so no Redis is needed there.
5. Hobby projects keep runtime logs for one hour and do not serve them through the API, so the run log lines below are only useful there through Vercel's **Observability → Errors** view, which aggregates everything logged at error level (`arc.run.failed`, `arc.run.candidate_failed`, and the `arc.client.*` events) for seven days. For retention, filtering, and alerts, add a [log drain](https://vercel.com/docs/log-drains); see [Observability](#observability).

`vercel.json` only pins the install and build commands; no rewrites or custom routing are needed.

## API

### `POST /api/optimize`

Body: `{ "prompt": string, "model": string, "judge": boolean, "rewrite"?: boolean, "context"?: string, "useCase"?: string, "refine"?: { "rounds": number, "variants": number }, "attachments"?: [{ "name": string, "type": string, "data": string }] }`. `rewrite` defaults to `true`; send `false` to run only the baseline and the three task-only pattern variants (critique, decomposition, structured reasoning) against the non-empty check. `context` (where the prompt runs and what it works on) and `useCase` (what the output is for and who reads it) are optional, at most 4,096 characters each, trimmed, and given to the rewrite only; blank values are ignored. `refine` is accepted only when `ARC_REFINE_ENABLED=1` and `judge` is `true` (400 otherwise); `rounds` and `variants` are each 1 to 3. The prompt must be non-empty and at most 16,384 characters; the model must be one of the ids in `lib/models.ts` (`anthropic/claude-sonnet-4-5`, `anthropic/claude-haiku-4-5`, `openai/gpt-5-mini`, `google/gemini-2.5-flash`, `minimax/MiniMax-M3`, `minimax/MiniMax-M2.7`, `opencode-go/deepseek-v4-pro`, `opencode-go/glm-5.3`, `opencode-go/kimi-k2.6`, `opencode-go/qwen3.7-plus`) and its provider key must be configured. Invalid requests return 400 with `{ "error": string }`; the per-IP limit of 10 runs per 10 minutes returns 429.

With `Accept: text/event-stream` the route streams Server-Sent Events, one per completed step (`rewrite` with its `status` when requested, `render` with the candidate ids and labels, one `run:<candidateId>` per candidate in completion order, then per revision round a `revise` with its `round`, `status`, and the revision's `candidateId` and `candidateLabel`, followed by that revision's `run:<candidateId>`, then `judge` when requested, `refine:<round>` with `improved` per refine round when requested, and `rank`), then a final `result` event. Without that header it returns the same result as a JSON body. The result is `{ baselineCandidateId, candidates, evaluations, ranking, judge, rewrite, plan, revisions, loop, refine, completionsUsed, model }`, where `candidates`, `evaluations`, and `ranking` are the core library's `PromptCandidate[]`, `CandidateEvaluation[]`, and `RankedCandidate[]`; `plan` says how the run scored (see below); `revisions` lists each revision round; `loop` reports how many rounds ran and why the loop stopped (`all_checks_passed`, `max_rounds`, `time_budget`, `revision_failed`, `candidate_failed`, `no_criteria`, `rewrite_failed`, or `not_requested`); `failures` lists the candidates whose completion failed (see below); and `refine` reports the refine rounds when requested.

Candidate completions run in parallel, through the core's `evaluateCandidate`, so a run waits for the slowest candidate rather than the sum of all of them. Each completion runs through the Vercel AI SDK with a 60 s timeout, or 120 s for MiniMax and OpenCode Go, and is aborted when the client disconnects. A candidate whose completion fails (one slow answer that hits the timeout, a rejected request) does not fail the run: it is reported under the result's `failures` as `{ candidateId, label, error: { kind, name, message, statusCode? } }`, its `run:<candidateId>` step event carries `status: "failed"` and the same `error`, and it has no evaluation and no rank, so the ranking covers the candidates that finished. When the rewrite's own run or a revision's run fails, the loop stops with `candidate_failed`. The run itself fails only when no candidate finished (or it was cancelled), with an error naming the first candidate that failed. `latencyMs`, `usage.inputTokens`, and `usage.outputTokens` are recorded from the provider response; `costUsd` is computed from the pay-as-you-go list prices in `lib/pricing.ts` only when both token counts are known and is otherwise left unknown (shown as `n/a`), never reported as 0. OpenCode Go models have no entry because the plan is a flat subscription, so their cost always shows `n/a`; with a MiniMax Coding Plan key the MiniMax figure is a list-price reference rather than a charge.

MiniMax and OpenCode Go are reached through the AI SDK's OpenAI-compatible provider. Every model on them thinks before answering, and that hidden reasoning counts against the output cap, so these models get a 16,384-token cap and `reasoning_effort: "low"`. Measured on the rewrite prompt, low effort took GLM-5.3 from no answer within 4,096 tokens to 18 s, DeepSeek V4 Pro from 88 s to 26 s, and MiniMax M3 from 40 s to 25 s. Qwen3.7 Plus and Kimi K2.6 ignore it, and Kimi needs about 110 s for a rewrite. Reasoning returned inline as `<think>…</think>` is stripped so only the answer is scored and measured.

### Image attachments

`attachments` carries up to 3 images (JPEG, PNG, WebP, or GIF) as base64 in `data`, at most 1.5 MB each and 3 MB together, so the request stays under Vercel's 4.5 MB body limit. The server checks each file's leading bytes against its declared type. Images are only accepted for models marked `vision` in `lib/models.ts` (Claude Sonnet 4.5, Claude Haiku 4.5, GPT-5 mini, Gemini 2.5 Flash, and MiniMax M3, whose OpenAI-compatible endpoint documents image input for that model; `GET /api/models` reports the flag); MiniMax M2.7 and the OpenCode Go gateway are not marked because their models' image support is unverified, and a request with attachments for them returns 400. The same images are sent, after the prompt text in one user message, with every completion of the run: the rewrite (so its plan fits the content), each candidate, every revision, and the refine generations. The core library sees prompt text only; the web adapter adds the images. Jev judges the prompt and output text and does not see the images, so the semantic score reflects the output without its visual grounding. Images are not stored: a background run's record keeps only each attachment's name, type, and size.

In the UI, "Attach images" opens the file or photo picker. While a text-only model is selected the button is disabled and the reason is written next to it, so it is visible on a phone where there is no hover tooltip. The browser downscales each image to 1,568 px on its longest edge and re-encodes it (PNG stays PNG when small enough, otherwise JPEG) before anything is sent, keeps the thumbnails with the draft and the result in `sessionStorage` when they fit, and refuses the run while a text-only model is selected with images attached.

### `POST /api/optimize/runs`

The same body as `POST /api/optimize`, the same validation, 400s, and per-IP limit, but the run is not tied to the connection: the response is `202 { "id": string, "status": "running" }` as soon as the run is accepted, and the run executes after the response is sent (Next's `after`, within the route's `maxDuration`). The web UI uses this endpoint, keeps the id in `localStorage`, and polls:

- `GET /api/optimize/runs?id=<id>` returns the run's record: `{ id, status, model, judge, rewrite, refine?, createdAt, updatedAt, steps, result?, error? }`. `status` is `running`, `done` (with `result`, the same shape as the `result` event above), `failed` (with `error: { kind, name, message, statusCode? }`, where `kind` is `timeout`, `cancelled`, `rate_limit`, `provider`, or `unknown`), or `cancelled`. `steps` holds every step event emitted so far, in order, so a client that reconnects can replay the progress it missed. A run that expired or was collected returns 404.
- `DELETE /api/optimize/runs?id=<id>` cancels a running run (the runner stops at its next step, and the record ends `cancelled`) or discards a finished one. The UI sends it as soon as it has collected a result, so the result leaves the store immediately; otherwise records expire 30 minutes after their last update.

The browser polls every 1.5 s while the page is visible and at once when the page becomes visible again or the device comes back online. If the page cannot reach the server (Safari reports `Load failed` when iOS suspends a backgrounded tab's requests), polling keeps retrying until 8 minutes after it started following the run, then gives up with a message. On the next visit within 30 minutes of starting a run (the server's retention of a run's record), the UI resumes following it, in the same tab after a reload or in a new tab; a run resumed in a tab that has no prompt in its session fills the prompt from the run's baseline candidate when the result arrives.

When a run produces nothing, the reason stays on the page: a failed run (the server's `error.kind` and `message`, the run id, and the last step it reached), a run the server no longer has, a lost connection, a refused start (400 or 429), or a run left behind longer than the server keeps it. The panel explains what to do for that kind (a timeout on a reasoning model suggests a faster model and names the per-completion limit), offers **Try again**, which reopens the confirmation for the same prompt, and **Dismiss**. It is kept in `sessionStorage` with the rest of the session, so it survives a reload, and it is shown even when the failure happened while the app was in the background; the error toast, which is gone in seconds and paused while the page is hidden, is kept as well. Failed runs are not discarded by the browser, so their record stays on the server for the retention period and the run id in the panel can be looked up with `GET /api/optimize/runs?id=`.

### The rewrite

With `rewrite` on, the route first calls the core's `rewritePrompt`, which asks the selected model to analyze the draft for vagueness, missing format, constraints, role, and examples, rewrite it, and reply with a plan. The form's "Rewrite details" fields send `context` and `useCase`, which the meta-prompt appends after the draft so the model can choose the role, audience, and format from them. The rewritten prompt joins the run as a `rewrite-<fingerprint>` candidate whose parent is the baseline. Its weakness and change notes come back under `rewrite.analysis` and `rewrite.changes`, shown under "Why it was rewritten" on the result card. A reply that cannot be parsed (no tagged or heading-marked rewritten prompt, or one cut off at the output limit) is retried once with a format reminder; `rewrite.attempts` counts the completions spent. If the retry also fails or the completion errors, the run continues with the baseline and the task-only pattern trio, `rewrite: { status: "failed", reason, attempts }`, and the reason is shown on the result card. Each rewrite attempt has a 120 s timeout and both together 150 s. The protocol is adapted from the prompt optimizer in [AI Engineering from Scratch](https://github.com/rohitg00/ai-engineering-from-scratch), MIT License; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### The plan and the checks

The rewrite reply's `<plan>` section is JSON naming the task type (one of the lesson's categories such as `summarization` or `analysis_review`), a suggested temperature, objective criteria any good answer must satisfy, and up to three catalog patterns worth trying for the task with task-specific values for their variables. The core's `parseRewritePlan` reads it leniently: unknown fields are ignored and invalid entries dropped. `planSuite` turns the criteria into a one-case evaluation suite (word limits, expected format, required keywords, forbidden phrases, plus the non-empty check, each with weight 1), and every candidate, including the baseline, is scored against the same suite, so the quality score is the fraction of checks an output passes. The result's `plan` is `{ status: "planned", taskType, temperature?, criteria, suiteId, patterns }`, or `{ status: "default", reason, suiteId, patterns }` when the rewrite failed, carried no readable plan, or named no criteria; in that case the suite is the preview suite's non-empty check and the pattern variants are the task-only trio.

### The loop

The lesson's optimization exercise is: run, score, find the weakest criterion, revise, repeat. After the first round, if the rewrite's output failed any check, the route calls the core's `revisePrompt` with the draft, the rewrite, the failed checks, and the failed output, runs the revision as a `rewrite-v2-<fingerprint>` candidate (label "Rewrite v2") whose parent is the rewrite, and repeats once more for a `rewrite-v3` if checks still fail. Each round is reported under `revisions` with the checks it targeted and the model's analysis and changes, shown under "Why it was revised" when that candidate is selected. A round runs only while the 240 s budget leaves room for a revise call and a run, estimated from the previous round's slowest completion. Without planned criteria there is nothing to revise against, so the loop does not run.

### The refine loop

A single pass cannot improve on itself: the pattern candidates are deterministic wraps of the original prompt, and the rewrite and its revisions only ever see the objective checks, never a verdict on how well the model answered. With `refine` on, the route closes that loop after the judge step using the core's `refinePrompt`. It takes whichever candidate Jev ranked first, shows the selected model that candidate's prompt, the output it produced, and Jev's verdict, and asks for a revision that fixes what fell short (the `REFINE_PROTOCOL` meta-prompt in `lib/arc-core/core/refine.ts`). It samples `variants` revisions at temperature 0.9 so they differ, runs each one, asks Jev one Score question per revision, and keeps a revision only if it scores strictly better than the incumbent; ties keep the incumbent. The next round refines the current best and lists the revisions that did not win so the model does not repeat them. It stops after `rounds` rounds, or early at a perfect score or the completion budget.

Refined candidates join the final ranking as `refine-r<round>-v<variant>-<fingerprint>` candidates whose parent is the candidate they revised. The result's `refine` field is `{ status: "refined", startCandidateId, bestCandidateId, rounds, stopReason }`, where each round lists its attempts (evaluated with the model's analysis and change notes, or duplicate, invalid, or failed with a reason) and whether it improved on the previous best; the result card shows the notes under "Why it was refined". If the judge did not run or the loop throws, the result carries the first-pass ranking and `refine: { status: "failed", reason }`.

Each round adds up to `variants` generations plus `variants` candidate runs, each judged, so the default 2 × 2 adds up to 8 completions and 4 Jev calls and can double a run's wall-clock time. The 300 s `maxDuration` is enough for the fast providers; on MiniMax and OpenCode Go a two-round refine can exceed it, which is why the flag is off by default.

When `judge` is true the route makes one request to `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`. The request `state` holds every candidate's `{ prompt, output }` pair, and one Score question per candidate, including the rewrite, asks "How well does the output fulfil the task in the prompt?" over the four levels *Off-task or empty*, *Addresses the task but incomplete or vague*, *Complete and accurate, some loose ends*, *Complete, accurate, and clearly organized* (each question names the pair it should judge). The returned `score` is divided by 3 and fed to the core as the judge score with the objective `{ deterministicWeight: 1, judgeWeight: 1, tieBreakers: ["totalTokens", "latencyMs", "costUsd"] }`. The raw `score`, `confidence`, `probabilities`, and `legend` are kept under `judge.answers[candidateId]`. If TypeSafe fails, the response carries the deterministic ranking and `judge: { status: "failed", reason }`.

### `GET /api/models`

`{ models: [{ id, label, provider }], judgeAvailable: boolean }`, filtered to providers whose key is present.

### `POST /api/client-events`

Body: `{ "event": "run_failed" | "run_lost" | "run_unavailable" | "run_start_failed" | "run_abandoned", "runId"?, "model"?, "kind"?, "message"?, "statusCode"?, "lastStep"?, "followedMs"?, "ageMs"?, "visibility"?: "visible" | "hidden", "online"?, "standalone"? }`, at most 4 KB. The web UI sends one when a run produced nothing from the browser's point of view (see [Observability](#observability)); the server writes it to the runtime log as `arc.client.<event>` and answers 204. The schema is closed and bounded (`lib/client-events.ts`): unknown fields are dropped, unknown events, kinds, models, and ids are rejected with 400, and no prompt content is accepted. The same per-IP limit as runs applies (429).

### `POST /api/prompts/categorize`

Body: `{ "prompt": string }`, non-empty and at most 48,000 characters. Uses TypeSafe's `jev-latest` with a Choice question and returns `{ category, confidence, model }`. Invalid bodies return 400, missing `TYPESAFE_API_KEY` returns 503, and upstream errors return 502. Suggestions have a separate per-IP limit of 10 requests per 10 minutes (429 with `Retry-After`); they do not consume the optimization limit. This endpoint classifies without storing the prompt or running an optimization. `ARC_MOCK_PROVIDERS=1` returns a test-only Writing category outside Vercel production.

## Core logic

The web app's `buildPatternCandidates` uses the core's `planPatternSpecs` and `generateCandidates` to render the patterns the plan chose, with the plan's task-specific variable values and the draft as the task. Without a usable plan it renders the patterns from the lesson's decision matrix for the task type that need only the task text, and failing that the critique, decomposition, and structured-reasoning trio. The Examples tab demonstrates task-specific values for every pattern and, in its Design section, prompts that are not pattern-based at all.

`generateCandidates`, `planPatternSpecs`, `planSuite`, `rewritePrompt`, `revisePrompt`, `refinePrompt`, `PREVIEW_SUITE`, `evaluateCandidate`, `aggregateCases`, `rankCandidates`, `DEFAULT_RANKING_OBJECTIVE`, and `listPatterns` all come from `lib/arc-core`. `lib/jev-judge.ts` adapts Jev to the core's `SemanticJudgeAdapter` so the refine loop can judge each revision as it is produced.

`lib/arc-core` is a verbatim copy of `src/core/*` and `src/adapters/completion.ts` rather than a package dependency. The published package's entry point re-exports the Pi completion adapter, which drags the whole Pi coding agent into the server bundle, and `dist/` is not committed, so a `github:` dependency cannot be built during a Vercel install. Only `lib/arc-core/adapters/index.ts` differs from the repository: it omits the Pi adapter export. `pnpm sync:arc-core` refreshes the copy, `pnpm check:arc-core` verifies it is byte-identical, and `tests/unit/arc-core-sync.test.ts` runs that check whenever the repository source is present.

`lineDiffSummary` is ported unchanged from `src/extension/review.ts` into `lib/diff.ts` because that module imports Pi types.

## Observability

Every run, on either endpoint, logs its lifecycle as JSON lines (`console.log`, or `console.error` for failures), which Vercel's runtime logs and [log drains](https://vercel.com/docs/log-drains) collect. Each line carries `source: "arc-prompt-optimizer"`, `event`, `runId`, `transport` (`job` for `/api/optimize/runs`, `stream` or `json` for `/api/optimize`), `model`, `judge`, `rewrite`, `refine` when requested, `attachments`, `client` (`{ mobile, platform, browser }`, a coarse description of the browser that started the run from its `sec-ch-ua-*` hints or User-Agent header: `platform` is `ios`, `android`, `macos`, `windows`, `linux`, `chromeos`, or `other`, `browser` is `safari`, `chrome`, `firefox`, `edge`, `samsung`, or `other`; no raw user agent is kept), and `elapsedMs` since the run started. Prompts, outputs, and rewrite notes are never logged.

| `event` | When | Extra fields |
| - | - | - |
| `arc.run.started` | the run was accepted | |
| `arc.run.step` | each step completed | `step`, and `status`, `round`, or `improved` as the step reports them |
| `arc.run.completed` | the run produced a result | `completionsUsed`, `candidates`, `candidatesFailed`, `rewriteStatus`, `judgeStatus`, `refineStatus`, `loopRounds`, `loopStoppedBecause`, `revisionsFailed`, plus `rewriteReason`, `judgeReason`, or `refineReason` when that stage failed inside an otherwise successful run |
| `arc.run.candidate_failed` | one candidate's completion failed while the run went on (logged at error level) | `step` (`run:<candidateId>`) and `error: { kind, name, message, statusCode? }` |
| `arc.run.failed` | the run threw (logged at error level) | `error: { kind, name, message, statusCode? }` and `lastStep`, the last step that completed before the failure |
| `arc.run.cancelled` | the run stopped early | `reason`: `client_disconnected` (the `/api/optimize` connection went away) or `cancel_requested` (a `DELETE` on the run), and `lastStep` |
| `arc.run.store_failed` | a background run could not save its record (Redis unreachable) | `error` |

The server can only log what it saw. Whether the browser ever collected the result is reported separately: the web UI sends one `POST /api/client-events` when a run produced nothing on its side, and the server logs it at error level as `arc.client.<event>` with the same `client` description, so a run that failed on a phone leaves two lines that can be joined on `runId`.

| `event` | When | Extra fields |
| - | - | - |
| `arc.client.run_failed` | the page saw the run end `failed` | `runId`, `model`, `kind`, `message`, `statusCode?`, `lastStep?`, `followedMs` |
| `arc.client.run_lost` | the page could not reach the server, or the run did not finish, within the 8 minutes it waits | `runId`, `model`, `message` (`unreachable` or `overdue`), `followedMs` |
| `arc.client.run_unavailable` | the server answered 404 for a run the page was following (expired, collected by another tab, or held by a replaced instance) | `runId`, `model`, `followedMs` |
| `arc.client.run_start_failed` | starting the run was refused | `model`, `message`, `statusCode?` |
| `arc.client.run_abandoned` | a run in progress when the page was last left was older than the 30-minute resume window when the page came back | `runId`, `model`, `ageMs` |

Every client event also carries `visibility` (whether the page was in the foreground when it noticed), `online`, and `standalone` (opened from the home screen as an installed web app).

To see failures in the Vercel dashboard, filter the project's logs on `arc.run.failed`; `error.kind` separates provider timeouts (`timeout`, usually a reasoning model exceeding the per-completion timeout), provider rejections (`provider`, with the upstream `statusCode`), provider rate limits (`rate_limit`), and the rest, and `client.mobile` separates phones from desktops. `arc.run.candidate_failed` marks a run that finished without one of its candidates. `arc.run.cancelled` with `client_disconnected` on the `stream` transport is the signature of a browser that dropped the connection mid-run, which the `/api/optimize/runs` flow avoids. On a Hobby project the Logs view keeps one hour; the **Observability → Errors** view keeps error-level lines for seven days, grouped by message, which is where `arc.run.failed`, `arc.run.candidate_failed`, and `arc.client.*` end up. A log drain or [Vercel Observability](https://vercel.com/docs/observability) alert on `arc.run.failed` turns this into monitoring. The same failure summary is stored on the run's record (`error`) and shown to the user in the failure panel, so a report from a user names the same `kind`, `message`, and `runId` as the log lines.

## Privacy

Prompts and model outputs stay in memory for the duration of a request on `/api/optimize`. A background run started through `/api/optimize/runs` (the web UI's path) keeps its record, including the prompt, the candidates, and their outputs, in the run store (Redis when configured, otherwise the instance's memory) until the browser collects the result and discards the run, or for at most 30 minutes after the run's last update. Attached images are sent to the provider with every completion of the run and are not stored by the server: a run record keeps only their names, types, and sizes. The server never logs prompt content or forwards it except to the provider you selected and, when requested, to TypeSafe for judging or category suggestions; run logs carry ids, statuses, counts, durations, and error summaries only. There is no analytics on prompt content. The browser keeps an active run, its progress, and its results across navigation between tabs, and keeps the active run's id in `localStorage` for 30 minutes so a reload, a backgrounded tab, or a new tab can pick the run back up. Cancel stops the active run on the server. The browser keeps the last prompt, completed result, and the reason the last run failed (the server's error summary, the run id, and the model, never the prompt) in `sessionStorage` so a refresh does not lose them; closing the tab clears it. When a run produces nothing, the browser reports the outcome to `POST /api/client-events` with the run id, the model, the error kind and message, and whether the page was in the foreground; these events never carry prompt content. Explicitly saved Library prompts are stored separately in `localStorage` until deleted or browser site data is cleared. Exported backups contain the saved prompt text, titles, categories, and category suggestion metadata.

## Scores

The deterministic score is the fraction of the planned checks an output passes; the result card lists the checks, each candidate row shows its pass count, and a failing row names the failed checks on hover. The checks are planned by the same model that wrote the rewrite, so they favor what it set out to do; they are applied identically to every candidate. Without planned checks the only check is that each output is non-empty, so every candidate passes 1/1 and scores tie at 1.00. Ties are broken by total tokens, then latency, then cost. The Jev score is a Score question over four levels, normalized and averaged with the deterministic score; its confidence reflects how spread the probability is across levels, not whether the answer is correct. When the latest revision or the rewrite ties for first, the result card shows it first, since token count says nothing about prompt quality.
