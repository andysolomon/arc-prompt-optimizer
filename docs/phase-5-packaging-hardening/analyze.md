# Phase 5 analysis — packaging, ARC Pi integration verification, hardening

## Request
Implement Phase 5 of `docs/prompt-optimizer-IMPLEMENTATION_PLAN.md` (items 5.1–5.6 in `docs/prompt-optimizer-progress.txt`).

## Evidence gathered (2026-09-16)
- Package `arc-prompt-optimizer@0.3.0`, `private: true`, not published to npm. `files` = `bin/arc-prompt`, `dist/**`; `prepack` builds. `npm pack --dry-run` ships 135 files (dist incl. `.map`/`.d.ts`, bin, package.json and README; npm does not auto-include CHANGELOG.md).
- Runtime deps: `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` `^0.84.4` as `dependencies`. Runtime value imports: `BorderedLoader` (extension `progress.ts`) and a lazy dynamic import in `src/cli/adapters.ts` (CLI real-model path). The CLI therefore genuinely needs Pi at runtime; the extension receives Pi from the host (Pi's loader aliases `@earendil-works/pi-*` imports to the host copy).
- Pi 0.84.4 package manager: npm installs use `--legacy-peer-deps`; **git installs run `npm install --omit=dev`**. `dist/` is not committed and `typescript` is a devDependency, so a `prepare` build cannot run in a git install. Git installs are therefore not supported for this release; local-path (after `npm run build`) and tarball installs are.
- Local ARC Pi checkout `../arc-pi` (`@andysolomon/arc-pi@1.47.0`) runs **Pi 0.80.7** and declares Pi packages as optional `peerDependencies: "*"` with devDependencies. Isolation: `ARC_PI_HOME` (default `~/.arc-pi`), `PI_CODING_AGENT_DIR` defaults to `ARC_PI_HOME`; `arc-pi install|remove|list` forwards to `pi` with that isolated dir. Our extension was developed against 0.84.4 (`ctx.mode`, `BorderedLoader`, `ctx.ui.*`) — **version drift is the main integration risk** and must be verified against 0.80.7.

## Decisions
- Keep Pi packages as `dependencies` (the standalone CLI needs them); add `engines.node`. Do not adopt the peer-only pattern because it would break `arc-prompt` real-model runs.
- Supported install paths: (1) standalone CLI from a clone or packed tarball; (2) Pi package via local path or tarball, loaded into ARC Pi with `arc-pi install <path>` / `pi -e` under the isolated `PI_CODING_AGENT_DIR`. Git installs are documented as unsupported.
- ARC Pi verification is an opt-in script (`ARC_PI_DIR`), not part of `npm test`, so this repo's tests never depend on a sibling checkout. It uses a fake/in-memory provider and never calls paid workers.
- 5.6: prebundling into ARC Pi is a separate follow-up, not part of the first release (plan §6 already defers it); record the decision and preconditions.
- No changes to the arc-pi repository.

## Out of scope
npm publication, git-install build support, ARC Worker Route comparison, changes to arc-pi source/monitor TUI.

## Step A findings
- Pi 0.80.7 has no `ModelRegistry.complete()`, so `/prompt-optimize` could not run completions inside ARC Pi. `createPiCompletionClientFromRegistry` now feature-detects it and falls back to `getApiKeyAndHeaders` + `@earendil-works/pi-ai/compat` `complete()`. A control run with the fallback disabled fails verification.
- Known limitation on Pi 0.80.x: the extension resolves its own pi-ai instance, so providers registered by other extensions with a custom `streamSimple` are unavailable; built-in API types work.
