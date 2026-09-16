# Phase 4 — Analyze

## Request
Finish Phase 4 of `docs/prompt-optimizer-IMPLEMENTATION_PLAN.md` (items 4.2–4.5). Item 4.1 is done on branch `feat/phase-4-pi-extension` (commit f74d5bc).

## Current state
- `src/extension/index.ts` registers `/prompt-optimize`. `src/extension/modes.ts` allows only TUI mode. In TUI mode the handler just shows a "not available yet" warning.
- `package.json` has a `pi.extensions` manifest → `./dist/extension/index.js`. Pi's `discoverAndLoadExtensions` loads it (see `test/extension.test.mjs`).
- Reusable pieces:
  - `generateCandidates` plus the `critique` / `decomposition` / `chain_of_thought` specs (see `optimizeSpecs` in `src/cli/main.ts`)
  - `evaluateSuite` (sequential; honours `signal` and `timeoutMs`)
  - `rankCandidates` + `DEFAULT_RANKING_OBJECTIVE`
  - `PiCompletionAdapter` + `createPiCompletionClientFromRegistry(ctx.modelRegistry)`
- Pi 0.84.4 UI surface: `select`, `confirm`, `editor`, `notify`, `getEditorText`, `setEditorText`, `custom` (TUI only; returns `undefined` in RPC), `BorderedLoader` (exported by pi-coding-agent). The context also exposes `ctx.model`, `ctx.scopedModels`, `ctx.modelRegistry.getAvailable()`, and `ctx.sessionManager.getBranch()`.

## Decisions
1. **No suite argument in the extension.**
   - Candidates are the source prompt as a baseline plus the three offline pattern variants.
   - A fixed built-in "preview" suite has one case with minimal criteria, so evaluation runs 4 completions.
   - This keeps the extension free of filesystem access. Suite files stay a CLI feature.
2. **Source selection.**
   - Non-empty command args are used as the prompt, labelled "command input".
   - Otherwise the user picks between the non-empty editor draft and the latest user message on the current branch.
   - If only one is available, it is used and labelled. If neither is, the command reports an error.
   - The size limit is 16,384 UTF-16 characters, matching the CLI.
3. **Target model.**
   - The picker lists `ctx.scopedModels` when that list is non-empty, otherwise `ctx.modelRegistry.getAvailable()`, with `ctx.model` first.
   - The command never calls `pi.setModel`.
   - Before any paid call, the user confirms the completion count and the model.
4. **Evaluation stays inside the extension.** Use core `evaluateSuite` rather than the CLI's `evaluateCandidatesBounded`. There is no CLI refactor, and the boundary test forbids CLI imports.
5. **Progress and cancellation.**
   - TUI: `ctx.ui.custom` + `BorderedLoader`. Pressing Escape aborts the loader signal, which is passed to evaluation.
   - RPC: `custom()` is unavailable, so progress goes through `notify`/`setStatus` and there is no interactive cancel. RPC dialogs work, so RPC mode becomes supported.
   - Print/JSON: still throw.
6. **Review.**
   - A `select` list shows each candidate with its score, whether it passed, latency, tokens, cost, and a line-diff summary against the source.
   - Choosing a candidate opens `ctx.ui.editor` prefilled with its text. After that, a `confirm` asks before replacing the editor draft via `setEditorText`.
   - Cancelling at any step leaves the editor untouched.
   - Nothing is submitted, persisted, or logged.

## Risks
- A `BorderedLoader` value import could load a second copy of pi-coding-agent. Mitigation: keep the loader code confined to one module so it is easy to swap.
- Real-model costs. Mitigation: an explicit confirmation before running, and a fixed cap of 4 completions.
- Tests must stay credential-free. Mitigation: fake `modelRegistry` / `ctx` objects throughout.
