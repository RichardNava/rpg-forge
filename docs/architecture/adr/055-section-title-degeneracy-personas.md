# ADR-055 — Section-plan title degeneracy: contract levers and personas

**Status:** Accepted
**Date:** 11/09/2026

## Context

The section-plan stage of character-sheet generation produced degenerate
single-character section titles across every benchmarked model. This decision
records the evidence, the constrained conclusions we may draw from it, and the
experiment contract used to steer the behavior without touching the production
contract.

### Observed behavior

Historical run `2026-09-09T21-49-32-474Z` exercised 3 models against all 9
fixtures through the production pipeline with live Workers AI inference. The
result was 0/27 fixtures accepted, and the raw artifacts record one-character
section titles in nearly every model and fixture:

- `gpt-oss-120b.en-core-melee-fighter`: titles `A, D, H, I, R, W, N`
- `gpt-oss-120b.en-gm-npc-guard`: titles `A` six times
- `gpt-oss-120b.es-hechicera-sanadora`: titles `A, M, S, C, H, I, N`
- `llama-3.3-70b.en-arcane-caster`: titles `C, M, P, C, A, I, R, C, S, B, A`
- `llama-3.3-70b.en-tinker-crafter`: 11 one-character titles
- `llama-3.3-70b.en-gm-npc-guard`: titles `V, C, T, I, N`
- `llama-3.3-70b.inject-prompt-hijack`: titles `i, r, l, n`
- `llama-4-scout.en-core-melee-fighter`: titles `A, B, C, D, E, F`
- `llama-4-scout.en-arcane-caster`: titles `C` five times

Artifacts live under `tmp/phase-14.5-sheet-benchmark/<runId>/`.

Later runs limited to `llama-3.3-70b.en-gm-npc-guard`
(`2026-09-10T12-45-19-128Z`, `2026-09-11T07-15-10-565Z`) reproduced the failure
against the current production contract. The provider outputs single-character
section titles; the runtime Zod schema (section title `minLength: 2`) rejects
them, e.g. `sections.0.title: Too small: expected string to have >=2
characters`. The correction replay returns single-character CJK glyphs still
below `minLength`, the section list grows from 5 to 11 (the schema cap is 12),
and the run ends `FAILED`.

### What the evidence proves about provider enforcement

This decision deliberately avoids a general claim about Workers AI JSON Mode
enforcement. It records only what this pipeline's runs demonstrate:

- Provider output violated runtime string constraints such as `minLength`.
- Runtime Zod validation correctly rejected the violating output.
- Runtime validation therefore remains the authoritative correctness and
  safety gate for generated content.
- Provider-side enforcement of string-content constraints (length, pattern,
  wording) cannot be relied on as the sole mechanism in this pipeline.

String-length constraints were present in the JSON Schema submitted to the
provider, yet the provider's outputs still violated them. Steering generated
text must therefore be achieved through the prompt/contract and through the
runtime gate, not through reliance on schema-side enforcement.

### Contributing contract weaknesses observed

These are prompt/contract issues, not provider-enforcement assumptions:

- The system prompt's only compactness instruction is "Keep section titles
  short and player-facing" (section-plan stage). No definition separates a
  machine key from a player-facing title.
- Output language is implicit: the only language signal is "same language as
  the character intent and the rules context". There is no explicit output
  language field, and the compiled spec records `metadata.locale = null`.
- The AI-facing JSON Schema produced by `z.toJSONSchema()` supplies
  `minLength`/`maxLength`/`pattern`/`enum` but no `description`s that
  distinguish `key`, `title`, and `purpose`, and nothing expresses that a
  title is a localized, human-readable heading.
- Retry feedback is abstract ("Too small: expected string to have >=2
  characters"): no locale, no counterexample, no "human-readable title"
  instruction, no anchor to the previously generated section list.
- A failing stage replays the whole plan, which is why the section list
  drifted from 5 to 11 instead of being preserved and repaired.

## Decision

- Keep runtime Zod validation as the authoritative gate; provider-side string
  enforcement is never treated as the sole safety/correctness mechanism.
- Steer section-plan output through prompt/contract levers, benchmark-side,
  before any production contract change.
- Personas A–F define one controlled lever per experiment envelope, executed
  through the existing benchmark harness (see
  `spikes/phase-14/sheet-benchmark/README.md`).
- Production schemas and prompts are not modified by this ADR. In particular,
  Persona F's baseline never weakens or edits production schemas and does not
  restore the historical `min(1)`; the OLD-era behavior is referenced only
  from historical run artifacts, and any "min(1)-like" profile is expressed
  solely as an isolated benchmark-side request variant.
- Output language stays benchmark-side for now: personas may pass an explicit
  locale in the benchmark request/prompt, but it is not promoted to the public
  `CharacterIntent` contract in this phase.
- The public `CharacterIntent` contract is not changed.

## Consequences

- Generated content correctness continues to depend on runtime validation; a
  payload that violates `minLength` must fail the stage, not be accepted.
- Persona experiments are isolated: no production schema, prompt, fixture, or
  adapter is mutated by an experiment. Schema deltas required by a persona are
  rendered benchmark-side by the shim worker, never by editing the canonical
  schemas.
- Converged deltas from a persona may later be promoted to production
  `prompt.ts`/schema in a separate, explicit change.
- Phase 2 adds the harness support (`--persona` selection) and the validation
  tests described in the benchmark README. No remote AI is consumed by
  automated tests.

## Outcome and resolution (12/09/2026)

The persona experiments did not converge on trusted, stable provider-emitted
section titles; provider-derived titles remained unreliable across the
benchmarked models and fixtures. The title-degeneracy risk is therefore
removed architecturally rather than by prompt tuning:

- **Section grouping and titles are now server-owned and deterministic.** Final
  construction emits exactly two sections (`Identity`, `Attributes`) with
  canonical localized titles. No AI section plan and no AI field candidates
  participate in the shipped contract.
- Runtime Zod validation remains the authoritative gate for any content that
  still passes through a provider at a bounded provider port.
- The personas and this ADR's experiment contract remain valid benchmarks-side
  historical evidence; none of the persona deltas were promoted to production.

This ADR is superseded in part by ADR-056 (deterministic character-sheet
construction).

## Related ADRs

- ADR-005 — AI provider abstraction
- ADR-012 — Workers AI binding
- ADR-054 — Zod 4 as canonical runtime and JSON Schema source
- ADR-056 — Deterministic character-sheet construction
