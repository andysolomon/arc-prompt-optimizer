# Decision: prebundling into ARC Pi (Phase 5.6)

Date: 2026-09-16
Status: decided — **deferred to a separate follow-up; not part of the first release.**

## Context

Plan §5 asks for a separate decision on whether a future ARC Pi release should prebundle `arc-prompt-optimizer`. Plan §6 lists "prebundling the optimizer into the ARC Pi distribution before the standalone package/API is stable" as out of scope.

The first release ships as:

- a standalone CLI,
- a Pi package that users install explicitly (`pi install <path>` or `arc-pi install <path>`).

## Decision

ARC Pi does not prebundle, depend on, or auto-install this package in the first release. Users who want `/prompt-optimize` in ARC Pi install it into the isolated profile themselves, as the README describes.

## Rationale

- **Release coupling.**
  - Prebundling would tie ARC Pi releases (`@andysolomon/arc-pi` 1.47.0) to this package's 0.x releases.
  - A fix in either project would need a coordinated release, and a regression here would ship inside ARC Pi.
- **Pi version drift.**
  - This package depends on Pi `^0.84.4`, while ARC Pi runs Pi 0.80.7.
  - Pi 0.80.7 has no `ModelRegistry.complete()`, so the extension feature-detects it and falls back to `getApiKeyAndHeaders` with `@earendil-works/pi-ai/compat`.
  - On 0.80.x, providers that other extensions register with a custom `streamSimple` are unavailable.
  - Bundling would lock that compatibility path into ARC Pi before either side settles on one Pi version.
- **Full-permission extension loading.** Pi extensions run with full local permissions. Loading one by default in every ARC Pi profile widens the trusted code surface without an explicit user choice.
- **Not published to npm.**
  - The package is `private: true` and has no registry artifact.
  - Git installs are unsupported because `dist/` is not committed and Pi runs `npm install --omit=dev`.
  - ARC Pi would have no stable, pinnable source to bundle.
- **API stability.** The core API, CLI JSON shape, and extension flow are still 0.x. Two feature (minor) releases, 0.2.0 and 0.3.0, shipped on 2026-09-16, and nothing yet guarantees stability across a minor release.

## Preconditions to revisit

Reopen this decision only when all of the following hold:

1. The package is published to npm, or ARC Pi can pin an immutable, checksummed tarball.
2. ARC Pi runs Pi >= 0.84, or the 0.80.x fallback stays covered by tests in this repository.
3. The public API (core exports, CLI JSON output, `/prompt-optimize` behavior) has stayed stable through at least one minor release.
4. `npm run verify:arc-pi`, or an equivalent check, runs in ARC Pi's CI against the bundled version.

## Non-changes

- No change to the ARC Pi repository, its monitor TUI, its session and monitor protocols, or the external ARC runner.
- The optimizer does not add, route, or compare ARC Worker Routes.
