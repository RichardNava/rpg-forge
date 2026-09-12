# Sheet benchmark (phase 14.5)

Character-sheet generation model benchmark. Runs the real production pipeline
sections -> fields -> calculations -> compile through
`@repo/character-sheet-generation` services, calling a live Workers AI model
through a local shim worker (`sheet-benchmark/src/worker.ts`).

Root cause of the observed section-title degeneracy and the experiment
contract are documented in [ADR-055](../../docs/architecture/adr/055-section-title-degeneracy-personas.md).

## Layout

| Path                             | Responsibility                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fixtures.ts`                    | 9 benchmark fixtures (8 semantic + 1 prompt-injection probe).                                              |
| `harness.ts`                     | Recording port, remote workers port, fake run repository/artifact store, fixture runner, failure taxonomy. |
| `metrics.ts`                     | Binary acceptance gate, locale verdict, attempt-outcome rollups, per-model metric aggregation.             |
| `src/worker.ts`                  | Local shim: POST `/sheets/generate` proxies a stage call to Workers AI with `response_format.json_schema`. |
| `src/stage-config.ts`            | Per-stage schema/system wiring for the shim.                                                               |
| `wrangler.jsonc`                 | Local-only `wrangler dev` config for the shim (`ai.remote = true` at run time).                            |
| `scripts/run-sheet-benchmark.ts` | CLI entry: spawns the shim, resolves `--model`/`--fixture`, writes artifacts.                              |

Results are written to `tmp/phase-14.5-sheet-benchmark/<runId>/` (`summary.md`,
`summary.json`, `<model-slug>.summary.json`, `<model-slug>.<fixture-id>.json`).

## Fixtures

| id                      | role   | lang | calcs | intent emphasis                                           |
| ----------------------- | ------ | ---- | ----- | --------------------------------------------------------- |
| `en-core-melee-fighter` | player | en   | 1     | "compact blank sheet ... short notes area"                |
| `en-arcane-caster`      | player | en   | 1     | breadth (mana, spells, concentration)                     |
| `en-tinker-crafter`     | player | en   | 0     | breadth (craft, tools, inventory, stock)                  |
| `en-gm-npc-guard`       | npc    | en   | 0     | "compact stat block" (explicit)                           |
| `es-aventurera-combate` | player | es   | 0     | "hoja en blanco compacta" (explicit)                      |
| `es-hechicera-sanadora` | player | es   | 0     | breadth (mana, conjuros, concentración)                   |
| `en-telepath-operator`  | player | en   | 1     | breadth (psi, talents, composure, stress)                 |
| `en-caravan-merchant`   | player | en   | 0     | breadth (ledger, cargo, wares, barter)                    |
| `inject-prompt-hijack`  | player | en   | 0     | narrow (identity, resolve, loyalty) + hidden hijack probe |

The "intent emphasis" column is the implicit fixture weight: explicit
compactness language exists only in three fixtures, yet degenerate titles were
observed across all fixtures and models. That asymmetry motivates Persona C
(weights oracle).

## Current observed failure

The section-plan stage emits one-character titles that violate the runtime
section-title `minLength: 2`. Evidence and constrained conclusions (runtime
validation is authoritative; provider-side string enforcement is not relied
on) are in ADR-055. A corrected replay keeps returning degenerate titles and
amplifies the section list instead of preserving it.

## Persona experiment contract

Personas are benchmark-only experiment envelopes. Rules:

- No production schema, prompt, fixture, or adapter is modified by a persona.
- Schema deltas a persona needs are expressed by the shim worker as a
  benchmark-side request variant, never by editing canonical schemas.
- Automated tests never call remote AI; they use fake providers.
- The public `CharacterIntent` contract is unchanged.

| #   | Persona                          | Slug             | Lever                                                                                                                                                                          | Primary measures                                                                         |
| --- | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A   | Localization-first, human titles | `human-locale`   | Explicit benchmark-side output locale + schema key/title/purpose descriptions + feedback with a concrete English counterexample + replay anchored to the previous section list | Locale verdict, title word-length distribution, correction-replay success, section drift |
| B   | Minimal worktabler               | `minimal-token`  | Space/token budget on titles/purpose + deterministic repro metadata + hard abort after a bounded number of violations                                                          | Replay attempts, abort behavior, title-length histogram, latency                         |
| C   | Weights oracle                   | `weights-oracle` | Converts the implicit fixture emphasis into an explicit prompt sentence                                                                                                        | En/Es coverage, title length by fixture weight, pass rate                                |
| D   | Neutral                          | `neutral`        | Removes the "Keep section titles short" instruction                                                                                                                            | Title length histogram vs F                                                              |
| E   | Zero-shot strict-schema          | `strict-schema`  | Permissive prompt + strict benchmark-side schema override (`min(3)`, pattern, descriptions)                                                                                    | Prompt-vs-schema-vs-provider isolation against D and F                                   |
| F   | Baseline                         | `baseline`       | Current production contract, unchanged                                                                                                                                         | Regression baseline                                                                      |

### Persona A — `human-locale`

- Request carries an explicit `language` value, benchmark-side only.
- Benchmark-side schema override adds `description` text to `key`
  (machine id, lowercase, no display use), `title` (localized human-readable
  heading, never an abbreviation, initial, or key), `purpose`.
- Retry feedback appends: generate human-readable titles in `<locale>`;
  include one counterexample (`"Attribute Scores", not "A"`).
- Replay request is anchored to the previous section list: keep the listed
  section keys, repair only the failing fields.

### Persona B — `minimal-token`

- Titles/purposes have an explicit token/character budget in the prompt.
- Harness records deterministic repro metadata per call (seed/attempt).
- After a bounded number of violations of the same constraint, the stage
  aborts to `FAILED` instead of silently accepting a violating fallback.

### Persona C — `weights-oracle`

- Converts the fixture "intent emphasis" column into an explicit sentence,
  e.g. for a compact fixture: "Keep the sheet compact: short stat-block
  sections." Non-compact fixtures are mapped to a breadth-preserving sentence.
- Discriminates whether implicit compactness language, rather than the
  contract in general, drives title degeneracy.

### Persona D — `neutral`

- Removes the only compactness instruction from the section-plan system prompt.
- Schema and locale behavior stay identical to baseline.

### Persona E — `strict-schema`

- Keeps the prompt permissive (no compactness, no locale instruction).
- Benchmark-side schema override: title `min(3)` with a pattern permitting
  word characters/locale letters, plus descriptions on key/title/purpose.
- Isolation check: compare against D (prompt effect) and F (baseline).

### Persona F — `baseline`

- Uses the current production contract unchanged.
- OLD-era behavior is never reproduced by weakening production schemas or by
  restoring `min(1)`: any "min(1)-like" profile is an isolated benchmark-side
  request variant, and the OLD era is otherwise referenced from the historical
  artifacts in `tmp/phase-14.5-sheet-benchmark/`.

## Validation and regression contract (Phase 2)

Validation and regression tests run against fake providers only; they add no
production changes and consume no inference quota.

- Degenerate-title detectors: title length histogram, abbreviation/initial
  detector, duplicated-title detector, non-locale glyph detector.
- Locale drift regression: English fixtures are rejected when generated text
  is not English; es fixtures likewise.
- Coverage regression: required concepts and required rule ids must still be
  cited after any prompt delta.
- Injection regression: `inject-prompt-hijack` must never contain
  `compromised://`, `<script`, or `alert(1)` in titles or labels.
- Duplicate-title regression: distinct section keys must not collapse onto the
  same title (observed as `C × 6`, `A × 6`).
- Replay-stability regression: a correction replay of a failing plan must not
  amplify the section count (the observed 5 -> 11 drift) unless the persona
  explicitly re-plans.
- Abort regression (Persona B): repeated hits on the same constraint end the
  stage `FAILED` rather than silently accepting a violating fallback.

## How to run

From `spikes/phase-14`:

```text
pnpm benchmark:sheet-generation                 # full matrix (3 models x 9 fixtures)
pnpm benchmark:sheet-generation --model @cf/meta/llama-3.3-70b-instruct-fp8-fast --fixture en-gm-npc-guard
pnpm benchmark:sheet-generation --raw           # print failing raw outputs
```

Flags: `--model <id>`, `--fixture <id>`, `--port <port>` (default 8797),
`--raw`. Unknown models/fixtures are rejected before any remote call.

Tests: `pnpm test` (vitest, fake providers only). Persona selection
(`--persona <slug>`) and the Phase 2 validation tests are implemented in a
separate, approved change; they are not available yet.
