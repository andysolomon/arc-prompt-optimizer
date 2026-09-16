# Phase 4 — Plan

Branch: `feat/phase-4-pi-extension`. Only the parent commits.

## Step A: source, models, run (items 4.2, 4.3) — workload class `medium-medium`
- ~~A1 `src/extension/source.ts`: collect the prompt sources (command input, editor draft, latest user message), apply the size limit, and resolve which source to use.~~
- ~~A2 `src/extension/models.ts`: list and label target models (scoped models → available models, active model first) and resolve the user's selection.~~
- ~~A3 `src/extension/run.ts`: build the candidates (baseline + 3 patterns) and the preview suite, run `evaluateSuite` through `PiCompletionAdapter` with the signal and timeout, and rank the results.~~
- ~~A4 `src/extension/progress.ts`: run work inside a TUI `BorderedLoader` with cancellation, or with RPC notify-based progress.~~
- ~~A5 `src/extension/command.ts`: wire it together — mode guard → source → model → cost confirmation → run → hand results to review (Step B). For now, report the ranked results via notify.~~
- ~~A6 Tests in `test/extension.test.mjs`, using fake context and registry only.~~

## Step B: review, acceptance, modes (items 4.4, 4.5) — workload class `medium-medium`
- ~~B1 `src/extension/review.ts`: line-diff summary, candidate summary lines, select → editor → confirm → `setEditorText`. Cancelling at any step makes no change.~~
- ~~B2 Mode handling: TUI and RPC supported; print/JSON throw. Update `modes.ts` and the 4.1 tests.~~
- ~~B3 Tests: no auto-submit, the editor is unchanged on cancel or abort, RPC uses dialogs without `custom`, print/JSON throw, and the isolation checks still pass.~~
- ~~B4 Update the README section and progress tracker 4.2–4.5.~~

## Verification
`npm run typecheck`, `npm test` (all green), `npm pack --dry-run` includes `dist/extension/*`.
