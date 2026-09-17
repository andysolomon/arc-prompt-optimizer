# Phase 5 verification record

Date: 2026-09-16
Branch: `feat/phase-5-packaging-hardening`
Package: `arc-prompt-optimizer@0.3.0`
Node: v26.7.0

## Hosts

| Host | Version | How verified |
| --- | --- | --- |
| Pi (package dependency) | `@earendil-works/pi-coding-agent` 0.84.4 | `npm test` |
| ARC Pi checkout | `@andysolomon/arc-pi` 1.47.0, Pi 0.80.7 | `npm run verify:arc-pi` |
| Local `pi` binary (installed separately) | 0.85.1 | `pi install` / `pi list` only (settings registration). No session was run. |

## Commands and results

### 1. ARC Pi integration check

```sh
ARC_PI_DIR=/home/andysolomon/Documents/Github/arc-pi npm run verify:arc-pi
```

Exit code: 0. Condensed output:

- `ok: true`, `arcPiVersion: 1.47.0`, `piVersion: 0.80.7`.
- `registered`: commands `["prompt-optimize"]`, with 0 tools, 0 handlers, 0 shortcuts, and 0 flags.
- `completionPath`: `legacy getApiKeyAndHeaders + pi-ai/compat`.

| Scenario | Completions | Editor writes | Notes |
| --- | --- | --- | --- |
| `tuiAccept` | 4 | 1 | Replaced after confirm |
| `rpcAccept` | 4 | 1 | Replaced after confirm |
| `tuiDeclineReplace` | 4 | 0 | |
| `rpcDeclineReplace` | 4 | 0 | |
| `tuiCancel` | 1 | 0 | |

- Print and JSON modes were refused (`printRefused: true`, `jsonRefused: true`).
- `networkAttempts: 0`.
- `tempProfileFiles: []`, so no credential-like files were created.
- The real `~/.arc-pi` was unchanged (14 entries).

### 2. Offline test suite

```sh
npm test
```

Exit code: 0. The command ran `tsc` and then `node --test test/*.test.mjs`.

- Result: 158 tests, 158 passed, 0 failed, 0 cancelled, 0 skipped.

| File | Tests |
| --- | --- |
| adapters | 21 |
| boundaries | 3 |
| canonical | 6 |
| cli | 24 |
| engine | 21 |
| extension | 27 |
| fixtures | 15 |
| package | 2 |
| patterns | 10 |
| pi-adapter | 21 |
| pi-compat | 3 |
| privacy | 5 |

### 3. Documentation examples (executed)

All commands used throwaway `/tmp` directories and exited 0 unless noted.

- **CLI help and catalog:**
  - `node bin/arc-prompt --help`
  - `optimize|evaluate|patterns|models --help`
  - `bin/arc-prompt patterns`
  - `bin/arc-prompt models --simulate`
- **README suite (`suite.json`):**
  - `arc-prompt optimize --simulate --suite suite.json --prompt "Return the user profile as JSON." </dev/null` ranked 3 candidates.
  - `arc-prompt evaluate --simulate ... --json </dev/null` succeeded.
  - Stdin input succeeded.
  - `--output out.json` wrote the file.
- **User-guide shape example** (`fixtures/weighted-suites.json` element 0 saved as its own file): `evaluate --simulate` exited 0.
  - Passing the fixture array file directly exits 2 with `INVALID_EVALUATION: Evaluation suite must be a plain object.`, as the guide says.
- **Stdin behavior:** running `--prompt` with an open, non-TTY stdin blocked until the command was killed. This is why the docs add `</dev/null`.
- **Packing and tarball install:**
  - `npm pack --pack-destination <tmp>` produced `arc-prompt-optimizer-0.3.0.tgz` (135 files).
  - `npm install -g --offline --prefix <tmp>/prefix <tgz>` succeeded from the npm cache.
  - The installed `arc-prompt patterns` and `optimize --simulate` both ran.
- **Pi local path:** `PI_CODING_AGENT_DIR=<tmp> pi install <repo>` and `pi list` recorded the package in the temp `settings.json`.
- **Pi from the installed tarball directory:**
  - `pi install <prefix>/lib/node_modules/arc-prompt-optimizer` succeeded.
  - Pi's `discoverAndLoadExtensions` on that directory returned no errors and registered only `prompt-optimize`.
  - The same loader on the raw `.tgz` path failed with `Unknown file extension ".tgz"`. That is why the README tells users not to pass the `.tgz` to Pi.
- **ARC Pi profile:**
  - `ARC_PI_HOME=<tmp> arc-pi install <repo>` and `arc-pi list` listed the package in the temp profile.
  - `PI_CODING_AGENT_DIR` defaulted to `ARC_PI_HOME`.

Not executed, per the no-network and no-global-mutation rules:

- `git clone`
- `npm ci`
- `npm link`
- an unprefixed `npm install -g`

The offline `--prefix` install above exercises the same tarball.

## Traceability

### Phase 5 acceptance criteria

| Acceptance criterion | Evidence |
| --- | --- |
| A clean installation can run the CLI offline and load the extension in an ARC Pi profile | `test/package.test.mjs` ("a clean extract of the tarball runs the CLI offline and loads only /prompt-optimize in Pi"); `scripts/verify-arc-pi.mjs` (temp `ARC_PI_HOME`/`PI_CODING_AGENT_DIR`, Pi 0.80.7); manual steps: `arc-pi install` into temp profile, prefixed tarball install (§3) |
| Full offline test/check suite passes where applicable | `npm test` (158/158, §2), `npm run verify:arc-pi` (§1). The ARC Pi repository's own suite was not run, because this phase made no changes there. |
| No existing ARC Pi source behavior or monitor TUI protocol changed | No files in `../arc-pi` were modified. The verify script only reads the checkout and asserts the real `~/.arc-pi` is unchanged. See `prebundling-decision.md` for the non-changes. |
| Documentation identifies unsupported claims (model quality, cross-route comparison) | `docs/user-guide.md` sections "Score interpretation", "Pi Providers vs ARC Worker Routes", and "Unsupported claims"; README "Installation" host limitations |
| Every shipped capability traces to a test or manual step | Table below |

### Shipped capabilities

| Capability | Tests / manual steps |
| --- | --- |
| Core patterns, validation, canonical serialization | `test/patterns.test.mjs`, `test/canonical.test.mjs`, `test/boundaries.test.mjs`, `test/fixtures.test.mjs` |
| Evaluation, judge, ranking, bounded generation | `test/engine.test.mjs` |
| Completion adapter contract and Pi adapter | `test/adapters.test.mjs`, `test/pi-adapter.test.mjs` |
| CLI (`patterns`, `models`, `evaluate`, `optimize`, `--simulate`, `--json`, `--output`, limits, timeouts) | `test/cli.test.mjs`; manual doc examples (§3) |
| Extension flow (source, model, cost confirm, progress/cancel, review, explicit accept, modes) | `test/extension.test.mjs`; `scripts/verify-arc-pi.mjs` TUI/RPC accept, decline, and cancel scenarios |
| Packaging (tarball contents, manifest paths, runtime deps, clean-extract smoke) | `test/package.test.mjs`; manual `npm pack` plus prefixed offline install (§3) |
| Privacy and safety (no logging/persistence, no interception, bounded I/O, cancellation, no prompt text in notify/status) | `test/privacy.test.mjs`; verify script `networkAttempts: 0` and `tempProfileFiles: []` |
| Pi 0.80 compatibility (legacy auth plus `pi-ai/compat` fallback) | `test/pi-compat.test.mjs`; `scripts/verify-arc-pi.mjs` (`completionPath: legacy ...`) |
| ARC Pi isolated-profile install | Manual: `ARC_PI_HOME=<tmp> arc-pi install <repo>` and `arc-pi list` (§3) |

## Remaining manual check

- A live TUI run of `/prompt-optimize` with a real, authenticated model, in both Pi 0.84.x and ARC Pi. Every automated check above uses fake or simulated providers. No real-model completion was made in this phase.
