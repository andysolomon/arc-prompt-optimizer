# Implement

## Evidence

- Status: completed
- Summary: Accepted existing Phase 2.1 private runtime journal draft and added public workflow-core export.
- Changes:
  - packages/workflow-core/src/journal/index.ts: append-only injected-filesystem runtime journal draft accepted
  - packages/workflow-core/test/journal.test.ts: focused journal/redaction tests accepted
  - packages/workflow-core/src/index.ts: exported journal API
- Verification:
  - 12 focused journal tests pass
  - Full npm test passes: 75 workflow-core, 13 adapter
  - typecheck, lint, diff-check, import probe, path/gitignore/source scans pass
- Risks:
  - Journal file-size rotation remains later work per plan
  - Unrelated .agents/.claude/skills-lock files remain untracked
- Next actions:
  - Draft Phase 2.2 event envelope implementation contract

## Evidence

- Status: completed
- Summary: Phase 2.2 repair applied locally: reject present-but-undefined payload/provenance fields and use non-undefined own-key counts for empty checks.
- Changes:
  - packages/workflow-core/src/events/validate.ts: added rejectUndefinedFields and definedOwnKeys helpers; payload and provenance validators now reject explicit undefined fields
  - packages/workflow-core/test/events.test.ts: new regression test covering single-undefined, multi-undefined, and unchanged valid envelope cases
- Verification:
  - Focused events tests: 18/18 pass (added present-but-undefined test)
  - Full npm test: 97 workflow-core and 13 adapter pass
  - typecheck, lint, diff-check all green
- Risks:
  - Local repair instead of delegation because the medium-light arc_delegate SIGTERM'd before producing work and opencode-go routes are temporarily unavailable
- Next actions:
  - Run Verify on the repaired Phase 2.2 module
  - Update README, implementation plan, and progress tracker after Verify acceptance

## Evidence

- Status: completed
- Summary: Phase 2.3 scheduler implemented: ready-set, default concurrency 4, wait policy, hybrid question queue, all pure.
- Changes:
  - packages/workflow-core/src/schedule/types.ts: scheduler, wait-policy, and queue types
  - packages/workflow-core/src/schedule/schedule.ts: readiness, concurrency, waiting, critical-path, and question-priority logic
  - packages/workflow-core/src/schedule/index.ts: scheduler public barrel
  - packages/workflow-core/src/index.ts: added schedule export
  - packages/workflow-core/test/schedule.test.ts: 6 focused scheduler and purity tests
- Verification:
  - Focused scheduler tests: 6/6 pass
  - Full tests: workflow-core 105/105, adapter 13/13 pass
  - typecheck, lint, diff-check, scheduler source scan pass
- Risks:
  - None reported
- Next actions:
  - Update README, implementation plan, and progress tracker for Phase 2.3 completion
  - Ask optional code review decision before Phase 3.x
