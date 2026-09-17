---
description: Generate prompt variants, run them with the current model, and rank them with deterministic checks
argument-hint: "<prompt text or path to a prompt file>"
---

Use the `prompt-optimize` skill from this plugin (`${CLAUDE_PLUGIN_ROOT}/skills/prompt-optimize/SKILL.md`) and follow its workflow exactly.

The prompt to optimize is:

$ARGUMENTS

If no prompt was given above, ask the user for the prompt text (or a file path) before doing anything else.
