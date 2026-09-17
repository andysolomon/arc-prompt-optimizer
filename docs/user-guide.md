# Arc Prompt Optimizer user guide

This guide covers writing evaluation suites, reading scores, choosing models, where Pi Providers end and ARC Worker Routes begin, and the privacy and safety behavior. For installation, see the README's [Installation](../README.md#installation) section.

## Evaluation suites

### How suites are loaded

`arc-prompt evaluate` and `arc-prompt optimize` take `--suite <file.json>`. The file must hold **one suite object**. The CLI:

- streams the file with an 8 MiB cap (`MAX_CLI_SUITE_JSON_BYTES` in `src/cli/io.ts`),
- parses the JSON and validates it with `validateEvaluationSuite`,
- requires at least one case.

Invalid JSON, unknown keys, or an empty suite fail with exit code 2 before any model is created.

The files in `fixtures/` (`evaluation-suites.json`, `weighted-suites.json`) are **arrays** of suites that the test suite uses. To run one through the CLI, copy a single element into its own file.

`arc-prompt evaluate` runs one candidate: your prompt as given. `arc-prompt optimize` runs three generated variants (critique, decomposition, and structured reasoning). Each candidate gets one completion per case.

### Shape

```json
{
  "id": "weighted-engine",
  "cases": [
    {
      "id": "profile-shape",
      "name": "Profile object shape",
      "completionFixtureId": "profile-json",
      "input": "Ada, engineer, active",
      "expectedOutput": "{\"name\":\"Ada\",\"role\":\"engineer\",\"active\":true}",
      "judgeRubric": "Score 1 when the profile fields are complete and accurate.",
      "criteria": {
        "jsonShape": { "rootType": "object", "requiredKeys": ["name", "role", "active"] },
        "maxCharacters": 120,
        "weights": { "json_shape": 3 },
        "custom": [
          { "id": "mentions-ada", "weight": 2, "kind": "includes", "value": "Ada", "caseSensitive": true }
        ]
      }
    }
  ]
}
```

**Suite fields**

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Matches `[A-Za-z0-9][A-Za-z0-9_.-]*`, at most 128 characters. |
| `cases` | yes | Array of cases, at most `MAX_EVALUATION_CASES` (64). Case ids must be unique within the suite. |

Unknown keys are rejected.

**Case fields**

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Same pattern and length as the suite id. |
| `name` | yes | String. |
| `completionFixtureId` | yes | String. The offline fixture and simulated adapters use it to pick canned output. Real Pi models never receive it. |
| `criteria` | yes | Object; see [Criteria](#criteria). It may be `{}`, but then the case has no score (see [Score interpretation](#score-interpretation)). |
| `input` | no | Entity-escaped, wrapped in `<evaluation_input>`, and appended to the candidate prompt. At most `MAX_CASE_INPUT_CHARACTERS` (16,384). |
| `expectedOutput` | no | Reference text, at most 16,384 characters. It is not compared automatically; use `exactMatch` for that. |
| `judgeRubric` | no | Used only when a `SemanticJudgeAdapter` is supplied through the library API. The CLI and the extension never run a judge. At most 16,384 characters. |

Unknown keys are rejected.

### Criteria

Every criterion becomes one weighted check. Built-in checks default to weight 1.

| Key | Check name | Passes when |
| --- | --- | --- |
| `expectedFormat` | `format` | Output is `"json"`, `"bullet_list"`, or `"numbered_list"`. |
| `maxWords` / `minWords` | `max_words` / `min_words` | The word count is within the bound. |
| `requiredKeywords` | `required_keyword` (one check per keyword) | The keyword appears, ignoring case. |
| `forbiddenPhrases` | `forbidden_phrase` (one check per phrase) | The phrase is absent, ignoring case. |
| `exactMatch` | `exact_match` | Trimmed output equals the trimmed value. |
| `maxCharacters` / `minCharacters` | `max_characters` / `min_characters` | The character count is within the bound. |
| `jsonShape` | `json_shape` | Output parses as JSON, matches the optional `rootType` (`"object"` or `"array"`), and has every `requiredKeys` own key. |
| `listShape` | `list_shape` | Output has at least one list item, and the item count is within the optional `minItems`/`maxItems`. |
| `custom[]` | `custom` | The `kind` comparison holds: `includes`, `excludes`, `equals`, `starts_with`, or `ends_with`. Custom checks are case-insensitive unless `caseSensitive` is `true`. |

Regular expressions are not supported.

### Weights

- `weights` overrides built-in weights by check name, for example `{ "json_shape": 3 }`.
- Every `custom` entry needs its own `weight`.
- A weight must be a finite number from 0 to `MAX_CRITERION_WEIGHT` (1,000).
- A case's score is `passedWeight / totalWeight`.

### Limits

The constants below, exported from the package root except where noted, are the source of truth for the limits:

| Constant | Value |
| --- | --- |
| `MAX_EVALUATION_CASES` | 64 cases per suite |
| `MAX_CUSTOM_CRITERIA` | 64 custom criteria per case |
| `MAX_JSON_SHAPE_KEYS` | 64 required keys |
| `MAX_CRITERION_WEIGHT` | 1,000 |
| `MAX_CRITERION_TERM_COUNT` | 128 `requiredKeywords` plus `forbiddenPhrases` terms per case |
| `MAX_CRITERION_TERM_CHARACTERS` | 1,024 per term or custom value |
| `MAX_CRITERION_TOTAL_TERM_CHARACTERS` | 16,384 characters across those terms |
| `MAX_CASE_INPUT_CHARACTERS` | 16,384 per `input`, `expectedOutput`, or `judgeRubric` |
| `MAX_EVALUATION_PROMPT_CHARACTERS` | 48,000 after candidate and input escaping |
| `MAX_EVALUATION_CANDIDATES` | 32 |
| `MAX_EVALUATION_COMPLETIONS` | 256 |
| `MAX_COMPLETION_OUTPUT_CHARACTERS` | 16,384 per completion; longer output fails instead of being truncated |
| `MAX_CLI_PROMPT_CHARACTERS` (CLI-internal, `src/cli/io.ts`) | 16,384 for CLI prompt input |

Every prompt is length-checked before the first completion runs.

## Score interpretation

- **`null` is not `0`.** A case with no criteria, or whose total weight is 0, has `score: null`. `0` means every weighted check failed. `null` means there was nothing to measure.
- **Measured or unknown.** Aggregate scores, latency, tokens, and cost are reported as `{ status: "measured", value }` or `{ status: "unknown", reason }`.
  - If any case score is unknown, the aggregate is unknown.
  - A missing cost or usage value is unknown, never zero.
  - The CLI prints `unknown`. The extension prints `n/a`.
- **Ranking order** (default objective `{ deterministicWeight: 1, judgeWeight: 0, tieBreakers: ["totalTokens", "latencyMs", "costUsd"] }`):
  1. Combined quality, descending. Unknown quality sorts last.
  2. Total tokens, then latency, then cost, ascending. Measured values come before unknown ones.
  3. Candidate id.

  Identical inputs give the same order.
- **Ties.** Candidates with equal quality share a competition rank (1, 1, 3). `tiedWith` lists the other candidates in the tie. `tieBrokenBy` names the measurement that ordered an entry relative to the entry before it. Operational measurements never change quality.
- **Judge weight defaults to 0.** A judge score, when present, is reported but cannot change the order. The CLI and the extension run no judge, so their judge column is unknown.
- **What a high score means.** A high score means the output passed *these deterministic checks* on *these cases* with *this model* at *this time*. It does not show that one prompt is better in general, that one model is better, or that results carry over to other inputs. Suites are small and completions are not deterministic, so a one-case difference can flip between runs.
- **`--simulate` scores measure nothing about prompts.** The simulated adapter ignores the prompt and returns canned text chosen by `completionFixtureId`.
- **The `/prompt-optimize` preview ranking is mostly operational.** Its built-in suite has one case whose only criterion is `minCharacters: 1` (non-empty output). Any non-empty reply scores 1, so ranking falls through to tokens, latency, and cost. Treat the review step as a side-by-side reading aid, not a quality verdict.

## Model selection

**CLI**

- `--model <provider/id>` selects the model for each request.
- `--default-model <provider/id>` sets the adapter fallback. The two flags cannot be combined.
- With neither flag, the Pi adapter resolves Pi's default model.
- Model names are at most 256 characters.
- `arc-prompt models` lists models from Pi's registry. `arc-prompt models --simulate` lists `simulate/balanced` and `simulate/fast`.
- Other bounds: `--concurrency` is 1..16 (default 4), and `--timeout`/`--timeout-ms` sets the completion timeout (default 30,000 ms).
- Without `--simulate`, the CLI builds Pi's default model registry for the current working directory. It uses the same Pi configuration and credentials that Pi itself would use, including `PI_CODING_AGENT_DIR` if set.

**Extension (`/prompt-optimize`)**

- The model list comes from your scoped models. If none are scoped, it comes from the available models.
- Duplicates are removed, and the active session model is listed first.
- A single option is selected automatically.
- The chosen model is used only for the four preview completions. **The session model is never changed.**

## Pi Providers vs ARC Worker Routes

The optimizer only targets **Pi Provider models** through Pi's model registry (`provider/id`, for example the providers you have logged in to in Pi or ARC Pi).

It does **not** run or compare **ARC Worker Routes**, such as Codex, Cursor Agent, Claude Code, or Composer workers that ARC Pi delegates to through its external runner. Those routes have their own CLIs, credentials, tool use, system prompts, and cost accounting, and none of that is visible through Pi's registry.

Scores from different routes are therefore not comparable. A candidate ranked on a Pi Provider model tells you nothing about how the same text behaves as an ARC worker task. Comparing worker routes is deferred work: it would need a new structured capability in the runner and separate cost and auth handling.

## Privacy and safety

- **No logging or persistence.**
  - The library and extension write no files, logs, or console output by default, and they read no credentials from the environment.
  - CLI stdout JSON is redacted and omits raw prompt and response text. Full text is written only when you pass `--output <file>`.
  - `test/privacy.test.mjs` checks these guarantees.
- **No interception.**
  - The extension registers only the `/prompt-optimize` command: no tools, event handlers, shortcuts, or flags.
  - It never rewrites, submits, or routes prompts on its own.
  - It never sends a message.
- **Bounded input and output.**
  - Prompts are limited to 16,384 characters (CLI and extension).
  - Completion output is capped, and over-limit output fails instead of being silently truncated.
  - Suite files, `--output` JSON, and judge data are also bounded.
- **Cancellation.**
  - In the TUI, Escape aborts the loader signal and stops further completions.
  - Cancelled or failed runs leave the editor untouched.
  - The CLI stops scheduling after the first failure and aborts in-flight completions.
- **Cost confirmation.** The extension asks for confirmation before any model call and states the completion count (4). Declining makes no completions. Replacing the editor text needs a separate confirmation, and nothing is submitted automatically.
- **Credentials.** The optimizer uses whatever Pi already has configured. Installing into ARC Pi's isolated profile copies no credentials. Pi extensions run with full local permissions, so review code before installing it.

## Unsupported claims

This project does **not** claim any of the following:

- That a higher-ranked candidate is a better prompt in general, or better outside the suite's deterministic checks and cases.
- That results rank model quality, or that scores are comparable across models, providers, or runs.
- That Pi Provider results predict behavior on ARC Worker Routes (Codex, Cursor Agent, Claude Code, Composer), or that it compares those routes at all.
- That `--simulate` output reflects any real model behavior.
- That the `/prompt-optimize` preview ranking measures quality. Its suite only checks for non-empty output.
- That unknown cost or token values are zero, or that reported cost is a billing record.
- That a semantic judge is used by the CLI or the extension (it is library-only and weighted 0 by default).
- Support for git installs, npm registry installs, Pi hosts other than 0.84.x and ARC Pi's 0.80.7, or providers with a custom `streamSimple` on Pi 0.80.x.
