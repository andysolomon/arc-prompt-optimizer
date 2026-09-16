# Prompt Optimizer — Implementation Plan

**Status:** Phases 1 and 2 and Phase 3.1, Phase 3.2, and bounded Phase 3.3 CLI contract with final CLI hardening complete; bounded CLI portions formerly listed under 3.4/3.5 are absorbed into Phase 3.3; remaining later 3.4/3.5 work, Phases 4–5, and ship/archive not started
**Approved Phase 1 contract:** `d45c63a5-134a-4b11-a319-2eea60602e55`
**Approved Phase 1 follow-up:** `0e71c607-dbbf-469a-8c97-8d4e52067f75`
**Approved Phase 1 final hardening:** `d6beba0b-eb53-4168-9bd1-663559f358d7`
**Phase 1 safety bounds:** Canonical values are limited to depth 64 and 48,000 serialized UTF-16 characters; criteria allow at most 128 combined terms, 1,024 characters per term, and 16,384 aggregate term characters. Overflow is reported as `CoreValidationError`.
**Phase 2 safety bounds:** `MAX_CRITERION_WEIGHT` is 1,000; `MAX_CUSTOM_CRITERIA` and `MAX_JSON_SHAPE_KEYS` are 64; generation is exactly specs × (1 + constraint variants) with `MAX_CANDIDATE_SPECS` 16, `MAX_CONSTRAINT_VARIANTS` 4, `MAX_CONSTRAINT_CHARACTERS` 2,048 raw characters per constraint before escaping, `MAX_EVALUATION_CANDIDATES` 32, `MAX_EVALUATION_CASES` 64, and `MAX_EVALUATION_COMPLETIONS` 256; `MAX_CASE_INPUT_CHARACTERS` is 16,384 for each case input, expected output, or judge rubric; `MAX_EVALUATION_PROMPT_CHARACTERS` is 48,000 after candidate/case-input escaping; judge sections are limited by `MAX_JUDGE_DATA_CHARACTERS` to 16,384, the complete judge prompt by `MAX_JUDGE_PROMPT_CHARACTERS` to 48,000, raw judge output by `MAX_JUDGE_RAW_OUTPUT_CHARACTERS` to 8,192, and rationale by `MAX_JUDGE_RATIONALE_CHARACTERS` to 2,000. Over-budget requests fail with `BUDGET_EXCEEDED` before any completion runs.
**Planning mode:** Hybrid greenfield + integration gap
**Suggested branch:** `feat/prompt-optimizer-core-cli-extension`
**Repositories:** `arc-prompt-optimizer` (core, CLI, and Pi package) plus the sibling `arc-pi` checkout for integration verification

## 1. Product goal and scope boundaries

Build a reusable prompt-optimization product that turns the educational pattern demo into a measurable, user-controlled workflow:

1. Compose prompt candidates from a user objective, constraints, and reusable patterns.
2. Evaluate candidates against user-provided examples and deterministic criteria.
3. Optionally use a model-based judge for semantic quality, while clearly separating measured facts from judge opinions.
4. Rank candidates using quality, latency, token usage, and cost signals.
5. Expose the same engine through a scriptable CLI and an interactive Pi extension.

The primary user experience is an explicit `/prompt-optimize` Pi command that shows candidates and places the selected draft in the editor. The CLI is the automation and CI surface. A separate Rust TUI is not part of the initial implementation.

### Scope boundaries

- The optimizer may generate and evaluate prompt text; it must not edit project source files or automatically submit a prompt to Pi.
- Optimization is explicit and user-initiated. Do not rewrite every prompt through an implicit `input`, `before_agent_start`, or provider-request hook.
- The core must be UI-, Pi-session-, and ARC-runner-independent.
- Use Pi model/provider APIs for the first real-provider implementation. Do not fan out through `arc_delegate` for ordinary candidate generation or evaluation.
- Do not copy or reuse provider credentials. The extension uses the Pi model registry supplied by its host; the CLI uses an explicitly configured Pi-compatible runtime or provider adapter.
- Raw prompts, transcripts, API keys, and model responses are not persisted or logged by default.
- The existing ARC orchestrator extension, ARC worker routing policy, session monitor, and delegation viewer remain behaviorally unchanged.

## 2. Current baseline

### Referenced sample

The referenced file is the `main` branch at commit `39ea8a1c6d0b61f071226eff7ede4d4105fed820`:

<https://github.com/rohitg00/ai-engineering-from-scratch/blob/39ea8a1c6d0b61f071226eff7ede4d4105fed820/phases/11-llm-engineering/01-prompt-engineering/code/main.ts>

It currently provides:

- A catalog of nine prompt patterns and required template variables.
- Template rendering with missing-variable validation.
- OpenAI, Anthropic, and Google-shaped request objects.
- Deterministic simulated responses with fake token and latency data.
- Rule-based checks for word limits, keywords, forbidden phrases, and basic formats.
- Model ranking by a simple average score.

It is not yet a product optimizer: `main()` uses hardcoded examples, no real provider is called, all TypeScript test cases require the word `Simulated`, and ranking does not incorporate the displayed cost or latency. The provider model aliases also do not consistently match the configured provider model IDs.

### `arc-prompt-optimizer` repository

The current repository is a greenfield release scaffold:

- `README.md` contains product positioning and release-process guidance.
- `package.json` is private at version `0.1.0` and currently exposes only a semantic-release script.
- There is no source tree, CLI, Pi manifest, test suite, or runtime dependency set yet.

### Local ARC Pi repository

The local ARC Pi checkout is a thin Pi distribution rather than a Pi core fork:

- `package.json` registers TypeScript extensions, skills, prompts, and themes through the `pi` manifest.
- `extensions/arc-orchestrator/index.ts` owns strict `arc_delegate`, user-only auth commands, background jobs, and session-run writes.
- `extensions/arc-session-monitor/` exposes read-only monitor helpers and `arc_monitor_status`.
- `tui/` is a separate Rust/ratatui delegation viewer consuming `arc-pi-monitor watch --json` NDJSON.
- `docs/architecture.md`, `docs/orchestration.md`, and `docs/security.md` establish the parent/worker, Pi Provider/Provider CLI, and privacy boundaries.

The installed Pi 0.84 extension API supports `registerCommand`, `registerTool`, `ctx.modelRegistry.complete`, `ctx.ui.custom`, `BorderedLoader`, `ctx.ui.editor`, editor text access, and TUI-only `appendEntry`. Pi's Q&A and handoff examples already demonstrate nested model completions and editor review flows.

## 3. Missing capabilities

1. **Core domain contracts:** prompt patterns, candidate provenance, evaluation cases, metrics, provider-neutral completion requests, and optimization results.
2. **Safe composition:** strict variable validation, delimiter/instruction-boundary handling, bounded text, and a catalog that can evolve without hardcoded `main()` behavior.
3. **Evaluation engine:** deterministic checks, weighted objectives, semantic-judge isolation, incomplete-measurement handling, and repeatable ranking.
4. **Real model adapter:** a narrow completion interface with cancellation, timeout, output bounds, usage, latency, and cost accounting.
5. **CLI:** file/stdin input, evaluation-suite loading, model selection, offline simulation, human-readable output, and stable JSON output for CI.
6. **Pi package/extension:** explicit command, prompt source selection, candidate review, model selection, cancellation, and editor handoff without automatic submission.
7. **Packaging and verification:** runtime dependencies, Pi package metadata, isolated ARC Pi installation checks, offline tests, documentation, and privacy regression tests.

## 4. Architecture and durable decisions

### Layering

```text
src/core                pure prompt composition, evaluation, and ranking
src/adapters            provider-neutral completion contract and Pi adapter
bin/arc-prompt           CLI wrapper
extensions/...           thin Pi command/UI adapter

Pi users ───────► extension ───────► core + host Pi model registry
CI/scripts ─────► CLI ─────────────► core + configured completion adapter
```

The optimizer repository should be installable as a normal Pi package. ARC Pi consumes it through Pi's normal package/settings mechanism; it should not require a fork of `arc-orchestrator`. Prebundling it into ARC Pi's own package can be evaluated after the package API stabilizes.

### Core contracts

Define provider-neutral types similar to:

- `PromptPattern`: name, description, template, variables, and optional generation guidance.
- `PromptCandidate`: stable ID, prompt text, origin, parent candidate, generation metadata, and redacted display metadata.
- `EvalCase`: input, expected output/reference, deterministic criteria, and optional judge rubric.
- `CompletionAdapter`: `complete(request, signal)` returning text, usage, model, finish reason, latency, and cost where available.
- `EvaluationResult` and `OptimizationResult`: per-case metrics, aggregate score, confidence/measurement status, and ranked candidates.

The core must not import Pi UI classes, `ExtensionContext`, ARC runner modules, or Node process globals except where an adapter boundary explicitly requires them.

## 5. Milestones / implementation slices

### Phase 1 — Pure foundation and offline fixtures

**Goal:** Replace the hardcoded demonstration with a deterministic, testable core that works without network access.

**Deliverables:**

- Add core TypeScript source under `src/core/` for patterns, template rendering, validation, and domain types.
- Port the useful sample patterns while keeping the catalog extensible; represent meta-prompt generation as an explicit strategy rather than an automatic trick.
- Add fixture-based simulated completions and representative evaluation suites under `fixtures/`.
- Add strict tests for missing variables, unknown patterns, bounded input, format checks, and stable serialization.
- Update `package.json` with the TypeScript build/check/test commands needed by the repository.

**Dependencies:** None beyond the repository's Node/TypeScript toolchain.

**Risks:** Overfitting tests to the sample's fake responses; accidentally treating absent metrics as failures.

**Acceptance criteria:**

- The core can render every supported pattern without a `main()` side effect.
- Invalid pattern names and missing variables fail with actionable errors.
- Offline fixture runs are deterministic and do not access network, credentials, Pi sessions, or ARC workers.
- Tests cover the sample's useful behavior without using `Simulated` as a proxy for quality.

### Phase 2 — Evaluation and optimization engine

**Goal:** Make “optimize” measurable rather than merely producing a rewritten prompt.

**Deliverables:**

- Add evaluation modules under `src/core/` for exact assertions, keyword/phrase checks, output-length checks, JSON/list shape checks, and user-defined weighted criteria.
- Add an optional semantic-judge adapter that receives delimited candidate output and returns a bounded structured judgment.
- Add candidate generation and bounded search in `src/core/optimize.ts` (initially a small candidate set/beam rather than unbounded iterative search).
- Rank by a documented objective function that separates quality from cost/latency and reports ties or unknown measurements honestly.
- Add tests for malformed judge output, prompt-injection-like candidate text, empty criteria, tie handling, and regression cases.

**Dependencies:** Phase 1 types, renderer, and fixtures.

**Risks:** LLM judges are variable and can be biased by candidate wording; semantic judgments may expose sensitive prompt data to another model; score weights can create misleading “winners.”

**Acceptance criteria:**

- A supplied evaluation suite produces per-case and aggregate results for every candidate.
- Deterministic criteria are independently inspectable from semantic-judge scores.
- Missing measurements are reported as unknown rather than silently converted to zero or success.
- Ranking is reproducible for the fixture adapter and includes quality, token, latency, and cost fields where available.
- Candidate and judge text is treated as data, delimited, bounded, and never executed as a tool instruction.

**Completed (2026-08-29):** `src/core/evaluation.ts` (weighted criteria, per-case/aggregate results, `Measurement` measured/unknown, all candidate/case completion prompts preflighted), `src/core/judge.ts` (escaped `<judge_data>` delimiters, strict `{score, rationale}` validation, non-throwing outcomes), `src/core/ranking.ts` (combined weighted quality only, total-order operational tie-breaking, competition ranks with `tiedWith`/`tieBrokenBy`), and `src/core/optimize.ts` (fingerprinted candidates with provenance, escaped-variant length preflight, hard budgets, generate → evaluate → rank). `EvaluationCriteria` is a superset of `DeterministicCriteria`; `CompletionResult.costUsd` is optional and unknown when absent. Verified by `test/engine.test.mjs` plus all Phase 1 tests. Semantic-judge behavior is verified only with in-process fake adapters; no model-backed judge exists until Phase 3.

### Phase 3 — Real completion adapter and scriptable CLI

**Goal:** Make the engine useful outside an interactive Pi session and suitable for CI.

**Deliverables:**

- Define a narrow adapter in `src/adapters/` so core logic can use real or fake completions without knowing provider payload formats.
- Implement a Pi-compatible adapter using public Pi model/runtime APIs where practical instead of duplicating the sample's hand-written provider request shapes.
- Add `bin/arc-prompt` and CLI modules with `optimize`, `evaluate`, and `patterns` operations.
- Support prompt text from an argument, file, or stdin; evaluation suites from JSON; explicit target model(s); bounded concurrency; `--simulate`; and `--json` output.
- Add human-readable tables that label heuristic, judge, and operational metrics separately.
- Add CLI tests using fake adapters and a packaging smoke test that does not require paid credentials.

**Dependencies:** Phases 1 and 2; public Pi API/runtime dependency decisions.

**Risks:** Pi model catalogs/auth behavior can change; standalone CLI authentication must not accidentally read or mutate the wrong profile; parallel calls can multiply cost.

**Acceptance criteria:**

- `arc-prompt patterns` lists the catalog without network access.
- `arc-prompt evaluate --simulate ... --json` emits stable machine-readable output suitable for CI.
- Real-adapter calls honor cancellation, timeout, output limits, and usage accounting.
- The CLI never writes raw prompt/response data unless the user explicitly requests an output file.
- Fake-provider tests pass without any provider credentials or ARC runner installation.

**Phase 3.1 completed (2026-09-02):** `src/adapters/completion.ts` and `src/adapters/index.ts` now expose a provider-neutral `CompletionAdapter.complete(request, signal?)` contract and `completeWithTimeout`. Requests support bounded optional model selection and an offline-only optional fixture hint. Results require text while model, finish reason, latency, usage, metadata, and cost remain optional so unavailable measurements stay unknown. Request/result values are normalized from own data fields before crossing adapter boundaries. Pre-abort, in-flight cancellation, timeout races, timer cleanup, prototype pollution, malformed results, partial usage, model forwarding, and direct/timeout evaluation paths are covered by credential-free tests. Active bounds are `MAX_COMPLETION_MODEL_CHARACTERS = 256`, `MAX_COMPLETION_PROMPT_CHARACTERS = 48,000`, `MAX_COMPLETION_OUTPUT_CHARACTERS = 16,384`, `DEFAULT_COMPLETION_TIMEOUT_MS = 30,000`, and `MAX_COMPLETION_TIMEOUT_MS = 2,147,483,647`. No Pi/provider payload implementation or CLI was added; those remain Phase 3.2–3.5.

**Phase 3.2 completed (2026-09-02):** `src/adapters/pi-completion.ts` adds `PiCompletionAdapter`, `createPiCompletionAdapter`, `createPiCompletionClientFromRegistry`, `buildPiCompletionContext`, and `mapPiAssistantMessage` on top of Pi 0.84.4 public `ModelRegistry`/`ModelRuntime.complete()` APIs. The adapter resolves explicit or default `provider/modelId` references with distinct ambiguous-vs-unknown errors, validates `defaultModel` at construction, scopes registry clients via `modelScope`, builds Pi `Context` messages, forwards cooperative `AbortSignal` (caller abort wins over client reject/never-settle), disables prompt caching (`cacheRetention: "none"`), uses conservative 1:1 `maxTokens` budgeting, rejects oversized output via Phase 3.1 `OUTPUT_TOO_LARGE` validation (no silent truncation), maps response model identity from assistant message fields, allows valid empty text, and maps usage/cost/latency/finish reason into the provider-neutral contract while rejecting `fixtureId`. Runtime deps are `@earendil-works/pi-coding-agent@^0.84.4` and `@earendil-works/pi-ai@^0.84.4` with type-only Pi imports and local text extraction to avoid eager pi-ai runtime loading from the package root. Credential-free coverage lives in `test/pi-adapter.test.mjs` with in-memory Pi-compatible clients.

**Phase 3.3 completed (2026-09-03; final CLI hardening 2026-09-04):** `bin/arc-prompt` and `src/cli/**` add a credential-free scriptable CLI with `patterns`, `models`, `evaluate`, and `optimize`. Top-level `--help`/`-h` and subcommand `--help` write documented help to stdout. Prompt sources are exactly one of `--prompt`, `--prompt-file`, or stdin and reject ambiguous, empty, and input above the effective CLI cap of 16,384 UTF-16 characters; stdin and prompt-file reads are bounded to that cap. Suites stream from `--suite` JSON with an 8 MiB cap; empty, invalid, and over-budget suites fail as exit-2 user-input errors before adapter setup. `--simulate` uses an in-memory adapter and simulated model catalog without importing live Pi runtime code; non-simulated adapter/model registry creation is lazy. `--model`/`--default-model` are bounded, `--concurrency` is capped at 16, and timeouts use the Phase 3.1 `completeWithTimeout` path through `--timeout` or compatibility alias `--timeout-ms`. CLI option validation, including duplicate `--output`, runs before non-simulated Pi registry/runtime creation. Stable `--json` output is deterministic, recursively key-sorted, redacted by default, and capped at 8 MiB including the trailing newline; raw prompt candidate text is written only through explicit `--output`, which uses the same newline-inclusive JSON cap. Evaluation scheduling stops after the first failure, including undefined rejections, and aborts in-flight completions. Human output separates heuristic, judge, and operational metrics. Package metadata includes the existing bin and built `dist/**` for dry-run packaging. The bounded CLI portions formerly listed under checklist items 3.4 and 3.5 are absorbed into Phase 3.3; separate later 3.4/3.5 work remains not started. Coverage lives in `test/cli.test.mjs`.

### Phase 4 — Pi package and interactive extension

**Goal:** Provide a safe, low-friction interactive workflow for ARC Pi and ordinary Pi users.

**Deliverables:**

- Add a Pi package manifest and an extension entry under `extensions/arc-prompt-optimizer/` (or an equivalent clearly isolated adapter directory).
- Register an explicit `/prompt-optimize` command. A model-callable tool is deferred unless a concrete use case requires it; the command avoids silently placing raw optimizer input into the parent model context.
- Support selecting the source prompt from explicit command input, the current editor draft, or the latest user message, with clear source labeling.
- Use `ctx.modelRegistry.complete` through the adapter, `BorderedLoader`/`ctx.ui.custom` for progress and cancellation, and `ctx.ui.editor` or `setEditorText` for review.
- Allow target-model selection from the host's available/scoped Pi models without changing the active session model.
- Show candidate differences, evaluation breakdowns, cost/latency/usage metadata, and a final user confirmation before replacing editor text.
- Persist nothing by default. If history is later added, use TUI-only custom entries and store metadata/fingerprints rather than raw prompt text unless explicitly opted in.

**Dependencies:** Phases 1–3 and the supported Pi 0.84 extension API.

**Risks:** Nested calls can create surprising cost or context behavior; custom UI must work in TUI/RPC modes and fail clearly in print/JSON modes; editor replacement can destroy a user's draft if confirmation is not explicit.

**Acceptance criteria:**

- `/prompt-optimize` can produce and display candidates from a user prompt in interactive mode.
- Escape/cancellation stops in-flight model work and leaves the original editor/session unchanged.
- The user can inspect, edit, and accept a candidate without automatic submission or source-file mutation.
- The extension reports unsupported non-interactive modes instead of trying to prompt invisibly.
- Existing ARC delegation, monitor, authentication, and TUI viewer behavior remains unchanged.

### Phase 5 — Packaging, ARC Pi integration verification, and hardening

**Goal:** Ship the layered product without weakening ARC Pi's trust or privacy boundaries.

**Deliverables:**

- Document installation as a standalone CLI and Pi package, including loading it in ARC Pi's isolated `PI_CODING_AGENT_DIR`/`ARC_PI_HOME`.
- Verify package contents, runtime dependencies, `npm pack --dry-run`, and installation into a clean temporary Pi profile.
- Run the extension against the local ARC Pi checkout in a fake-provider/in-memory scenario; do not invoke paid workers.
- Add privacy and safety checks for no default raw logging, no credential copying, bounded output, cancellation, and no automatic prompt interception.
- Add user documentation covering evaluation-suite authoring, score interpretation, model selection, and the distinction between Pi Providers and ARC Worker Routes.
- Decide separately whether a future ARC Pi release should prebundle the package; do not couple the first implementation to the monitor TUI or ARC runner.

**Dependencies:** Phases 1–4 and access to the local ARC Pi checkout for verification.

**Risks:** Version drift between Pi and the package; package installation may load extensions with full local permissions; prebundling could introduce release coupling.

**Acceptance criteria:**

- A clean installation can run the CLI offline and load the extension in an ARC Pi profile.
- The full offline test/check/format suite passes in both repositories where applicable.
- No existing ARC Pi source behavior or monitor TUI protocol is changed by the initial package integration.
- Documentation accurately identifies unsupported claims, especially model quality and cross-route comparison.
- A reviewer can trace every shipped capability to a test or manual verification step.

## 6. Out-of-scope and deferred work

- A separate Rust/ratatui prompt editor. The existing Rust TUI is a read-only delegation monitor; a Pi custom overlay is sufficient initially.
- Automatic optimization of every user input or provider request.
- Direct comparison of all ARC Worker Routes, including Cursor/Claude Code/MiniMax/Composer, as if they were Pi Providers. This would require a new structured capability in the external runner and separate cost/auth handling.
- Repository-aware prompt optimization that reads project files, skills, or full system prompts by default.
- Automatic source-file edits, commits, pushes, GitHub mutations, or deployment actions.
- Unbounded evolutionary search, training/fine-tuning, embeddings, remote evaluation services, or team dashboards.
- Prebundling the optimizer into the ARC Pi distribution before the standalone package/API is stable.

## 7. Acceptance-criteria mapping

| Product criterion | Phase(s) | Verification |
| --- | --- | --- |
| Reusable pattern composition with validation | 1 | Core unit tests and offline fixtures |
| Measurable candidate evaluation | 2 | Deterministic evaluator, malformed-judge, and regression tests |
| Real provider/model execution with usage and cancellation | 3 | Fake adapter tests plus bounded live smoke test when explicitly authorized |
| Scriptable CLI and stable JSON output | 3 | CLI integration tests for stdin/file/JSON/simulate paths |
| Interactive ARC Pi prompt review | 4 | TUI manual QA and extension tests |
| Original draft/session remains safe until acceptance | 4 | Cancellation and no-auto-submit tests |
| No credential/logging/routing-boundary regressions | 5 | Privacy checks, isolated-profile install, and ARC Pi verification |
| Existing ARC monitor and delegation behavior unchanged | 4–5 | Existing ARC Pi test suite and monitor fixture tests |

## 8. Immediate next steps

1. Approve the layered delivery shape: pure core + `arc-prompt` CLI + standalone Pi package/extension; defer Rust TUI and ARC Worker Route fan-out.
2. Confirm the minimum supported Node/TypeScript/Pi versions and whether the CLI should reuse Pi's model runtime or provide direct provider adapters.
3. Implement Phase 1 only, preserving the offline fixture mode before adding paid/provider-backed calls.
4. After Phase 1, run its focused tests and review the public core contracts before beginning Phase 2.
5. Keep this plan and `docs/prompt-optimizer-progress.txt` synchronized as each phase is completed. When all work is complete, move both files to `docs/archive/` and record that archival step in the tracker.
