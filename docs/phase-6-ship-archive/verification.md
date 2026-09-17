# Phase 6 verification record

Date: 2026-09-17
Branch: `chore/phase-6-ship-archive` (from `main` at `20f2c00`, tag `v0.5.0`)
Package: `arc-prompt-optimizer@0.5.0`
Node: v26.7.0

This covers all of Phase 6:

- **6.1:** every applicable check was run and all acceptance criteria were reviewed (below).
- **6.2:** the user approved release and merge on 2026-09-17 ("ship it") after reviewing this record, including the open manual checks.
- **6.3:** `docs/prompt-optimizer-IMPLEMENTATION_PLAN.md` and `docs/prompt-optimizer-progress.txt` were moved to `docs/archive/`. `test/engine.test.mjs` now reads the archived paths.

## Hosts

| Host | Version | How verified |
| --- | --- | --- |
| Pi (package dependency) | `@earendil-works/pi-coding-agent` 0.84.4 | `npm test` |
| ARC Pi checkout | `@andysolomon/arc-pi` 1.47.0 (`b5e9de8`), Pi 0.80.7 | `npm run verify:arc-pi` |
| Local `pi` binary | 0.85.1 | Not used in this phase |
| Claude Code | 2.1.273 | `claude plugin validate .` |

## Commands and results

| Command | Exit | Result |
| --- | --- | --- |
| `npm run typecheck` | 0 | No errors |
| `npm test` | 0 | 176 tests: 176 passed, 0 failed, 0 cancelled, 0 skipped |
| `git status --porcelain` after the build | — | Clean, so the committed skill tool bundle matches a fresh build |
| `ARC_PI_DIR=../arc-pi npm run verify:arc-pi` | 0 | `ok: true`; see below |
| `claude plugin validate .` | 0 | Marketplace manifest validation passed |
| `npm pack --dry-run --json` | 0 | 171 files, 150,208 bytes packed, 714,081 unpacked |

### Test counts by file

| File | Tests |
| --- | --- |
| adapters | 21 |
| boundaries | 3 |
| canonical | 6 |
| cli | 24 |
| cli-harness | 10 |
| engine | 21 |
| extension | 27 |
| fixtures | 15 |
| package | 2 |
| patterns | 10 |
| pi-adapter | 21 |
| pi-compat | 3 |
| plugin-manifest | 5 |
| privacy | 5 |
| skill-tools | 3 |

### ARC Pi integration check

- Only the `prompt-optimize` command was registered, with 0 tools, 0 handlers, 0 shortcuts, and 0 flags.
- `completionPath`: `legacy getApiKeyAndHeaders + pi-ai/compat`.

| Scenario | Completions | Editor writes |
| --- | --- | --- |
| `tuiAccept` | 4 | 1 (after confirm) |
| `rpcAccept` | 4 | 1 (after confirm) |
| `tuiDeclineReplace` | 4 | 0 |
| `rpcDeclineReplace` | 4 | 0 |
| `tuiCancel` | 1 | 0 |

- Print and JSON modes were refused.
- `networkAttempts: 0` and `tempProfileFiles: []`.
- The real `~/.arc-pi` was unchanged (14 entries).
- `../arc-pi` has no tracked changes. Its only untracked file is its own `.claude/settings.local.json`, which this project did not create.

### Package contents

Top-level entries in the tarball: `.claude-plugin`, `README.md`, `bin`, `commands`, `dist`, `package.json`, `skills`. The exact allowlist is asserted by `test/package.test.mjs`.

## Acceptance criteria review

These are the product criteria from §7 of the implementation plan.

| Product criterion | Phase(s) | Status | Evidence |
| --- | --- | --- | --- |
| Reusable pattern composition with validation | 1 | Met | `test/patterns.test.mjs`, `canonical`, `boundaries`, `fixtures` |
| Measurable candidate evaluation | 2 | Met | `test/engine.test.mjs` (deterministic criteria, malformed judge, injection-like input, ties, regressions) |
| Real provider/model execution with usage and cancellation | 3 | Met offline; live smoke not run | `test/adapters.test.mjs`, `pi-adapter`, `pi-compat`, and the verify script's cancel scenario. The plan requires a live smoke test only "when explicitly authorized", and none was authorized. |
| Scriptable CLI and stable JSON output | 3, 7 | Met | `test/cli.test.mjs` (stdin, file, JSON, simulate, limits) and `test/cli-harness.test.mjs` (`candidates`, `score`) |
| Interactive ARC Pi prompt review | 4 | Met by automated tests; manual TUI QA still open | `test/extension.test.mjs`, verify script TUI/RPC scenarios. No human has run `/prompt-optimize` with a real model. |
| Original draft/session remains safe until acceptance | 4 | Met | Decline and cancel scenarios write to the editor 0 times; `test/extension.test.mjs` and `test/privacy.test.mjs` cover no auto-submit |
| No credential/logging/routing-boundary regressions | 5 | Met | `test/privacy.test.mjs`; isolated-profile verify run (`networkAttempts: 0`, no credential-like files, real profile unchanged) |
| Existing ARC monitor and delegation behavior unchanged | 4–5 | Met | No project change touches `../arc-pi`. The extension registers no tools, handlers, shortcuts, or flags. |
| Harness-agnostic skill and Claude Code plugin (added in Phase 7) | 7 | Met by automated checks; live plugin run still open | `test/skill-tools.test.mjs` (drift check, out-of-repo run), `test/plugin-manifest.test.mjs`, `claude plugin validate .` |

## Scope boundaries review

These come from §1 of the plan.

- **No source edits or auto-submit:** the extension writes the editor only after an explicit confirm. The skill tells the agent never to submit or write files.
- **Explicit, user-initiated:** the extension has no `input`, `before_agent_start`, or provider-request hooks (asserted by the registration counts).
- **Core independence:** `src/core` has no Pi or UI imports. The skill bundle runs outside the repo with no dependencies (`skill-tools` test).
- **No credential copying:** the extension uses the host's model registry. Candidate and score tools make no model calls.
- **No persistence or logging by default:** covered by `test/privacy.test.mjs`. `--output` is the only way to write full JSON.

## Checklist items 3.4 and 3.5

Both items were marked "later work not started" after their bounded CLI scope was absorbed into 3.3. No further work was ever defined for them, and nothing in §7 depends on them. They are closed as absorbed so that Phase 3 can be marked complete.

## Still open (manual, needs a human or authorization)

1. **Pi live run:** run `/prompt-optimize` in Pi 0.84.x and ARC Pi with a real, authenticated model.
2. **Claude Code plugin live run:**
   ```
   /plugin marketplace add andysolomon/arc-prompt-optimizer
   /plugin install arc-prompt-optimizer@arc-prompt-optimizer
   /prompt-optimize <prompt>
   ```

These did not block approval or the archive, but the release notes and README should not claim that live-model use was verified until they are done.

## Known follow-ups (not in plan scope)

- `arc-prompt` with `--prompt` waits on an open non-TTY stdin. The docs work around this with `</dev/null`.
- The skill's user-suite input wrapping is not entity-escaped.
- CI has no drift check for the committed skill tool bundle. The `skill-tools` test covers it locally.
- The `~/.codex/skills` install path is unverified.
- Prebundling into ARC Pi is deferred (`docs/phase-5-packaging-hardening/prebundling-decision.md`).
