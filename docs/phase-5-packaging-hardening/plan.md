# Phase 5 plan

Workload class: medium-medium (implementation), docs as a second step.

## Step A — packaging, ARC Pi verification, hardening checks (code)
- [x] ~~A1 `package.json`: add `engines.node` (>=22.19.0, matching arc-pi); no dependency moves.~~
- [x] ~~A2 `test/package.test.mjs`: `npm pack --dry-run --json` contents allowlist (only `bin/arc-prompt`, `dist/**`, `package.json`, `README.md`, `CHANGELOG.md`, license if any); no `src/`, `test/`, `docs/`, `fixtures/`, `.github`, `node_modules`, `.env`; manifest paths (`bin`, `exports`, `pi.extensions`) resolve to packed files; runtime deps limited to the two Pi packages.~~
- [x] ~~A3 Clean-install smoke (in test, offline-safe): pack to a temp dir, extract, symlink this repo's `node_modules`, run `bin/arc-prompt` offline `--simulate` path and load the extension via `discoverAndLoadExtensions` with an empty temp agent dir.~~
- [x] ~~A4 `scripts/verify-arc-pi.mjs` (opt-in, `ARC_PI_DIR`): with a temp `PI_CODING_AGENT_DIR`/`ARC_PI_HOME`, load the built extension using ARC Pi's own Pi runtime (0.80.7), assert only `/prompt-optimize` registered, drive the command end-to-end with a fake in-memory model/UI (no network, no paid workers), confirm the temp profile holds no copied credentials and the real `~/.arc-pi` is untouched. `npm run verify:arc-pi`.~~
- [x] ~~A5 `test/privacy.test.mjs`: no default raw logging (no console/fs writes/process.env credential reads in `src/core`, `src/extension`); no `pi.on`/tool/shortcut/flag registrations (no automatic interception); bounded outputs (over-limit prompt refused, completion output limits enforced); cancellation leaves editor untouched and stops further completions; credential-like strings in prompts are never written to notify/status beyond the chosen candidate display.~~

## Step B — documentation
- [x] ~~B1 README "Installation": standalone CLI, Pi package (local path/tarball), ARC Pi isolated profile, git-install limitation.~~
- [x] ~~B2 `docs/user-guide.md`: evaluation-suite authoring, score interpretation, model selection, Pi Providers vs ARC Worker Routes, unsupported claims.~~
- [x] ~~B3 `docs/phase-5-packaging-hardening/prebundling-decision.md` (5.6).~~
- [x] ~~B4 Record ARC Pi verification evidence; update progress tracker.~~
