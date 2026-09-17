# Arc Prompt Optimizer

Most people write prompts like they are texting a friend. Then they wonder why a 200-billion parameter model gives mediocre answers. Prompt engineering is not about tricks. It is about understanding that every token you send is an instruction, and the model follows instructions literally. Write better instructions, get better outputs. It is that simple and that hard.

## Installation

The package is not published to npm (`private: true`). Install it from a local clone or from a tarball you pack yourself. It requires Node.js 22.19.0 or newer. See [docs/user-guide.md](docs/user-guide.md) for suite authoring, score interpretation, and model boundaries.

### Use it in any agent harness

The `prompt-optimize` skill works in any agent harness that loads [Agent Skills](https://agentskills.io). The harness's own agent generates candidate outputs with whatever model and auth it already has. The bundled tool at `skills/prompt-optimize/scripts/arc-prompt-tools.mjs` only renders candidates and scores outputs. It makes no model or network calls, needs only Node.js 22.19.0 or newer, and has no npm dependencies, so it runs from a plain git checkout without `npm ci` or a build.

**Claude Code plugin**

```text
/plugin marketplace add andysolomon/arc-prompt-optimizer
/plugin install arc-prompt-optimizer@arc-prompt-optimizer
/prompt-optimize Summarize this incident report for executives.
```

The plugin provides the `prompt-optimize` skill, which Claude can also pick on its own when you ask it to improve a prompt, and a `/prompt-optimize <prompt>` command.

**Other skills-capable harnesses**

Copy or symlink `skills/prompt-optimize` from a clone into your harness's skills directory, for example `~/.claude/skills/` for Claude Code without the plugin, or `~/.codex/skills/` for Codex. For other harnesses, see their docs for where skills live. Keep the whole directory, including `scripts/`.

```sh
git clone https://github.com/andysolomon/arc-prompt-optimizer.git
mkdir -p ~/.codex/skills
ln -s "$PWD/arc-prompt-optimizer/skills/prompt-optimize" ~/.codex/skills/prompt-optimize
```

**Pi**

A Pi install (see [Pi package](#pi-package)) provides both the native `/prompt-optimize` extension, which runs candidates through a Pi model you pick, and the same skill through the `pi.skills` manifest.

**Plain CLI**

`arc-prompt candidates` and `arc-prompt score` are the same model-free commands, for scripts or harnesses without skills support. Run `arc-prompt candidates --help` and `arc-prompt score --help` for flags and the outputs JSON schema.

The harness workflow has trade-offs. The same agent writes the variants and produces their outputs, scores come from deterministic checks only, the default preview suite only checks that outputs are non-empty, and latency, tokens, and cost stay unknown unless the harness reports them. See [docs/user-guide.md](docs/user-guide.md#harness-agnostic-workflow).

### Standalone CLI

```sh
git clone https://github.com/andysolomon/arc-prompt-optimizer.git
cd arc-prompt-optimizer
npm ci
npm run build
bin/arc-prompt --help
```

To put `arc-prompt` on your `PATH`, run `npm link` from the clone. Or pack a tarball and install that:

```sh
npm pack                                         # runs the build, writes arc-prompt-optimizer-<version>.tgz
npm install -g ./arc-prompt-optimizer-<version>.tgz
```

The CLI needs `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` at runtime for real-model runs, so they are regular dependencies. `--simulate` runs without credentials or network access. For example, save this suite as `suite.json`:

```json
{
  "id": "readme-example",
  "cases": [
    {
      "id": "profile-json",
      "name": "Profile is a JSON object",
      "completionFixtureId": "json-profile",
      "input": "Ada, engineer",
      "criteria": {
        "expectedFormat": "json",
        "jsonShape": { "rootType": "object", "requiredKeys": ["name", "role"] },
        "weights": { "json_shape": 3 },
        "custom": [{ "id": "mentions-ada", "weight": 2, "kind": "includes", "value": "Ada", "caseSensitive": true }]
      }
    }
  ]
}
```

```sh
arc-prompt patterns
arc-prompt models --simulate
arc-prompt optimize --simulate --suite suite.json --prompt "Return the user profile as JSON." </dev/null
arc-prompt evaluate --simulate --suite suite.json --prompt "Return the user profile as JSON." --json </dev/null
```

The simulated adapter returns canned text selected by `completionFixtureId` and ignores the prompt, so simulated scores exercise the pipeline only. They say nothing about prompt quality. The CLI reads stdin whenever stdin is not a terminal, so redirect `</dev/null` when you pass `--prompt` or `--prompt-file` from a script. Otherwise the command waits for stdin to close.

### Pi package

Build first, because the extension manifest points at `dist/extension/index.js` and `dist/` is not committed:

```sh
npm ci && npm run build
pi -e /abs/path/to/arc-prompt-optimizer          # load for one session
pi install /abs/path/to/arc-prompt-optimizer     # add to Pi settings
```

To use a packed tarball, install the tarball with npm and point Pi at the installed directory. Do not pass the `.tgz` file to Pi, because Pi's extension loader cannot load a `.tgz` path:

```sh
npm install -g ./arc-prompt-optimizer-<version>.tgz
pi install "$(npm root -g)/arc-prompt-optimizer"
```

Git installs (`pi install git:...`) are not supported. `dist/` is not committed, and Pi runs `npm install --omit=dev` for git sources, so the TypeScript build cannot run.

### ARC Pi isolated profile

```sh
arc-pi install /abs/path/to/arc-prompt-optimizer
arc-pi list
```

`arc-pi install` forwards to `pi install` with ARC Pi's isolated `PI_CODING_AGENT_DIR`. That directory defaults to `ARC_PI_HOME`, which defaults to `~/.arc-pi`. The package is recorded there, not in `~/.pi/agent`. No credentials are copied into or out of the profile. The extension uses whatever Pi providers the ARC Pi profile already has. Pi extensions run with full local permissions, so install only code you trust.

Supported hosts:

- Pi 0.84.x. The package depends on `^0.84.4` and its tests run against that version.
- ARC Pi's Pi 0.80.7. `ARC_PI_DIR=/path/to/arc-pi npm run verify:arc-pi` checks it with a fake in-memory provider. On Pi 0.80.x the extension resolves its own `pi-ai` instance. Built-in API types work, but providers that other extensions register with a custom `streamSimple` are unavailable to `/prompt-optimize`.

## Offline core

Phase 1 provides a side-effect-free TypeScript API for strict prompt-pattern rendering, bounded fixture completions, deterministic fixture checks, and canonical serialization. It does not call providers, submit prompts, persist content, or integrate with Pi or ARC workers.

```ts
import { renderPattern } from "arc-prompt-optimizer";

const rendered = renderPattern("persona", {
  role: "a senior technical writer",
  experience: "ten years documenting APIs",
  style: "precise and concise",
  priority: "clarity over breadth",
  task: "Explain API rate limits.",
});

console.log(rendered.text);
```

Pattern variables are strict: missing, extra, malformed, or over-limit input fails with a deterministic `CoreValidationError`. Candidate generation is guidance-only and must be explicitly initiated by a future caller; rendering never runs it automatically.

Variable values are treated as untrusted data. Rendering escapes the five framing metacharacters as reversible entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;`) before substitution, so a value cannot inject closing XML-like tags or quote delimiters. Text without those characters is preserved verbatim, including whitespace and newlines. Output limits are checked against the escaped length before the final string is allocated.

Run the offline checks with `npm run typecheck`, `npm run build`, and `npm test`.

## Evaluation and optimization engine

Phase 2 adds a deterministic, bounded evaluation and optimization engine on top of the Phase 1 core. It is still offline: it runs against any `CompletionAdapter` (the fixture adapter today), makes no network calls, reads no credentials, and never submits, persists, or logs prompts or responses.

```ts
import { FixtureCompletionAdapter, optimize } from "arc-prompt-optimizer";

const result = await optimize({
  adapter: new FixtureCompletionAdapter(completions),
  specs: [{ pattern: "critique", variables: { task: "Summarize the profile." } }],
  constraintVariants: ["Reply in JSON."],
  suite: {
    id: "profile",
    cases: [{
      id: "shape",
      name: "Profile object shape",
      completionFixtureId: "profile-json",
      criteria: {
        jsonShape: { rootType: "object", requiredKeys: ["name", "role"] },
        weights: { json_shape: 3 },
        custom: [{ id: "mentions-ada", weight: 2, kind: "includes", value: "Ada" }],
      },
    }],
  },
});

result.ranking[0]; // { rank, candidateId, quality: {...}, operational: {...}, tiedWith, tieBrokenBy }
```

### Deterministic weighted criteria

`evaluateOutput(text, criteria)` treats output strictly as data and returns one weighted check per criterion. `EvaluationCriteria` is a superset of the Phase 1 `DeterministicCriteria`: every Phase 1 criteria object evaluates identically (all weights default to 1). Phase 2 adds `exactMatch`, `maxCharacters`/`minCharacters`, `jsonShape` (root type and required own keys), `listShape` (bullet/numbered item count), `weights` (per built-in check), and `custom` weighted criteria of kind `includes`, `excludes`, `equals`, `starts_with`, or `ends_with`. Regular expressions are intentionally not supported. The per-case `score` is `passedWeight / totalWeight`; when there are no criteria or the total weight is 0 it is `null`, never 1 or 0.

`evaluateCase`, `evaluateCandidate`, and `evaluateSuite` produce per-case results (`deterministic`, `judge`, and `measurements` are separate fields) and a per-candidate aggregate. Case `input` is entity-escaped and wrapped in `<evaluation_input>` before it is appended to the candidate prompt.

### Measurements are measured or unknown

Latency, token usage, and cost are reported as `{ status: "measured", value }` or `{ status: "unknown", reason }`. A missing `costUsd` or usage field is unknown, not zero, and any unknown case makes the aggregate mean unknown with an explanatory reason.

### Optional semantic judge

Pass a `SemanticJudgeAdapter` (`judge(request) => Promise<unknown>`) to score cases that define a `judgeRubric`. The engine builds the judge prompt itself: fixed instructions followed by `<judge_data name="...">` sections whose contents are entity-escaped, so candidate output cannot close a delimiter or inject a section. Data over 16,384 characters is skipped with a reason rather than truncated. Judge output must be exactly `{ "score": 0..1, "rationale": string }` (JSON string or plain object, at most 8,192 raw characters, rationale at most 2,000); anything else yields `{ status: "invalid" }`, adapter errors yield `{ status: "failed" }`, and neither ever affects deterministic scores.

### Ranking objective

`rankCandidates(evaluations, objective)` is reproducible for identical inputs regardless of input order. The default objective is `{ deterministicWeight: 1, judgeWeight: 0, tieBreakers: ["totalTokens", "latencyMs", "costUsd"] }`:

1. Combined quality = weighted mean of the deterministic and judge scores over the weighted components, descending. If any weighted component is unknown the combined quality is unknown and sorts last; nothing is imputed.
2. Configured operational tie-breakers, in order, ascending. Within a tie-breaker a measured value orders before an unknown one so the order is total; an unknown value is never treated as zero.
3. Candidate id, ascending.

The individual judge score is reported but is never an independent comparator. With `judgeWeight: 0`, it cannot affect order or quality-tie grouping. Candidates with exactly equal combined quality share a competition rank (1, 1, 3) and list each other in `tiedWith`; `tieBrokenBy` names the operational measurement that ordered an entry relative to the previous one, or is `null`. Operational fields are reported on every ranked entry but never contribute to quality.

### Bounded candidate generation

`generateCandidates` renders each spec through the pattern catalog (generation 0) and optionally appends each escaped, `<constraints>`-delimited constraint variant (generation 1). There is no iterative search: candidate count is exactly `specs × (1 + constraintVariants)`, capped at 16 specs, 4 variants, 32 candidates, 64 cases, and 256 completions. Every candidate has a stable id derived from a canonical fingerprint of its spec, and `provenance` records generation, spec/variant indexes, and parent id. `optimize` chains generate → evaluate → rank and rejects over-budget requests before any completion runs.

### Phase 2 safety bounds

The exported constants are the source of truth for active limits: `MAX_CRITERION_WEIGHT = 1,000`; `MAX_CUSTOM_CRITERIA = 64`; `MAX_JSON_SHAPE_KEYS = 64`; `MAX_CANDIDATE_SPECS = 16`; `MAX_CONSTRAINT_VARIANTS = 4`; `MAX_CONSTRAINT_CHARACTERS = 2,048` raw characters per constraint before escaping; `MAX_EVALUATION_CANDIDATES = 32`; `MAX_EVALUATION_CASES = 64`; `MAX_EVALUATION_COMPLETIONS = 256`; `MAX_CASE_INPUT_CHARACTERS = 16,384` characters for each case `input`, `expectedOutput`, or `judgeRubric`; and `MAX_EVALUATION_PROMPT_CHARACTERS = 48,000` characters after candidate/case-input escaping. Generated constraint variants and every candidate/case prompt are length-preflighted before completion calls.

Judge sections are limited by `MAX_JUDGE_DATA_CHARACTERS = 16,384`, the complete judge prompt by `MAX_JUDGE_PROMPT_CHARACTERS = 48,000`, raw judge output by `MAX_JUDGE_RAW_OUTPUT_CHARACTERS = 8,192`, and rationale by `MAX_JUDGE_RATIONALE_CHARACTERS = 2,000`. Phase 1 template, canonical, criteria-term, and fixture-output bounds remain active as documented above.

## Pi extension

The package is also a [Pi package](https://pi.dev/packages): its `pi.extensions` manifest loads `dist/extension/index.js`, which registers an explicit `/prompt-optimize` command. The extension registers no tools or input hooks, persists nothing, and never submits prompts on your behalf.

```bash
npm run build
pi -e /path/to/arc-prompt-optimizer
```

Running `/prompt-optimize [prompt]`:

1. **Source.** Text after the command is used directly. Otherwise, you pick between the editor draft and the latest user message; if only one exists, it is used. Prompts are limited to 16,384 characters.
2. **Model.** Pick the target model from your scoped models, or from the available models if none are scoped. The active model is listed first. The session model is never changed.
3. **Cost confirmation.** Nothing calls a model until you confirm the run: 4 completions, for the source baseline plus three pattern variants.
4. **Progress.** In the TUI, a bordered loader shows progress and Escape cancels the run. Cancelled or failed runs leave the editor untouched.
5. **Review.** A ranked summary lists each candidate's score, pass/fail, latency, tokens, cost (`n/a` when unknown), and a line diff against the source. Pick a candidate, edit it, then confirm to replace the editor text. You can instead keep the current text, or cancel at any step, and nothing changes.

The command never auto-submits. After a replacement, you review and submit the editor text yourself. RPC mode is supported through dialogs, with progress reported through status and notifications and no interactive cancel. Print and JSON modes are unsupported and fail with a message pointing to the `arc-prompt` CLI.

## Releases

Releases run automatically from `main` with semantic-release. Use Conventional Commits so changes can be versioned correctly:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

Versions are still in the `0.x` range. The first release was `0.1.0`, and the current version is `0.3.0`. The GitHub Actions release workflow updates the package version and changelog, creates a GitHub release, and does not publish to npm. Preview a release locally with:

```sh
npm ci
npm run release -- --dry-run --no-ci
```
