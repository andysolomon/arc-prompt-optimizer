# Phase 7 analysis — model- and harness-agnostic prompt optimization

## Request (2026-09-16)
"prompt-optimize needs to be model and harness agnostic … should adhere to whatever system. maybe its claude plugins. maybe its skills for another harness." Then: "We want both. The integration and plugin if available and a general skill file."

## Current coupling
- `src/core` is already model-neutral (`CompletionAdapter`), offline, deterministic.
- The CLI reaches real models only through Pi's model registry (`src/cli/adapters.ts`), or `--simulate`.
- The interactive `/prompt-optimize` flow (source → candidates → run → rank → review → accept) exists only as a Pi extension.

## Design
1. **Harness's agent is the model.** A portable skill instructs whatever agent runs it (Claude Code, Codex, Cursor, OpenCode, Pi, …) to produce candidate outputs with its own model and auth. No provider adapters, keys, or registries are needed for this path.
2. **Model-free deterministic CLI tools** the skill calls from any shell:
   - `arc-prompt candidates` — render the baseline plus pattern variants (same set as the Pi extension: critique, decomposition, chain_of_thought) for a prompt. No model calls.
   - `arc-prompt score` — take agent-produced outputs (JSON file or stdin) plus an optional suite, run deterministic evaluation and ranking, emit a ranked result. Without a suite, use the same non-empty-output preview suite as the extension. Measurements supplied by the harness are used; missing ones stay `unknown`.
3. **Distribution, integration where available plus a general skill:**
   - General skill: `skills/prompt-optimize/SKILL.md` (Agent Skills format), usable by any skills-capable harness.
   - Claude Code plugin: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (installable with `/plugin marketplace add andysolomon/arc-prompt-optimizer`), plugin-discovered `skills/` and a `commands/prompt-optimize.md` slash command.
   - Pi: keep the existing `/prompt-optimize` extension (native integration) and also declare the skill via `pi.skills`.
4. Existing Pi-registry CLI path (`optimize`/`evaluate`/`models`) stays unchanged.

## Trade-offs to document honestly
- Same agent authors variants and produces outputs: less independent than separate model calls; scores reflect deterministic checks only.
- Latency/tokens/cost are `unknown` unless the harness reports them.
- The skill can't replace the editor text automatically in harnesses without that API; it presents the chosen prompt for the user to copy/use, and never submits it.

## Out of scope
Direct provider HTTP adapters, MCP server, changes to arc-pi.
