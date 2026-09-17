# Phase 7 plan

## Step A — model-free CLI tools (medium-medium)
- [x] ~~A1 Extract the candidate set used by `src/extension/run.ts` into a shared harness-neutral module (e.g. `src/core/preview.ts` or `src/workflow/`), reused by the extension with no behavior change.~~
- [x] ~~A2 `arc-prompt candidates [--prompt|--prompt-file|stdin] [--json]`.~~
- [x] ~~A3 `arc-prompt score [--suite file] (--outputs file | stdin) [--json]` with a strict, bounded outputs schema.~~
- [x] ~~A4 Tests, help text, no network/model calls asserted.~~

## Step B — skill, Claude Code plugin, Pi skill manifest (easy-medium)
- [x] ~~B1 `skills/prompt-optimize/SKILL.md` (general, harness-agnostic).~~
- [x] ~~B2 Claude Code plugin + marketplace manifests and `commands/prompt-optimize.md`.~~
- [x] ~~B3 `package.json` `files` + `pi.skills`; package test allowlist updated; manifest validation tests.~~
- [x] ~~B4 README + user guide: harness-agnostic usage, per-harness install, trade-offs.~~

Phase 7 applied 2026-09-17: B0 self-contained skill tool bundle (`scripts/build-skill-tools.mjs` builds the committed `skills/prompt-optimize/scripts/` from `src/cli/harness-main.ts` after `tsc`) and B1–B4 complete. `plugin.json` version is synced by the npm `version` lifecycle script that `@semantic-release/npm` triggers, and committed through `@semantic-release/git` assets.
