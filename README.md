# Arc Prompt Optimizer

Most people write prompts like they are texting a friend. Then they wonder why a 200-billion parameter model gives mediocre answers. Prompt engineering is not about tricks. It is about understanding that every token you send is an instruction, and the model follows instructions literally. Write better instructions, get better outputs. It is that simple and that hard.

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

## Releases

Releases run automatically from `main` with semantic-release. Use Conventional Commits so changes can be versioned correctly:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

The initial version is `0.1.0`. The GitHub Actions release workflow updates the package version and changelog, creates a GitHub release, and does not publish to npm. Preview a release locally with:

```sh
npm ci
npm run release -- --dry-run --no-ci
```
