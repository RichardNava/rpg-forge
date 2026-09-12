# Phase 14.5 Character-Sheet Generation — Deterministic Construction

**Status:** Implemented (Iteration 2E frozen)
**Date:** 2026-09-12

## Purpose

The standalone character-sheet generator turns a validated GUI authoring
request plus an optional single READY `RulesContext` into a canonical
`CharacterSheetSpec`. The pipeline is deterministic everywhere except two
narrow provider ports, both isolated behind the project's provider-agnostic
contracts and exercised in automated tests exclusively with fake providers.

Implementation lives in `packages/character-sheet-generation`; the canonical
renderer-neutral contract lives in `packages/character-sheet-schema`.

## Frozen pipeline

```text
GUI authoring request ──normalizeGuiSource──▶ Level-2 GUI source
                                             (deterministic, no AI)

optional single READY RulesContext ──RulebookFieldDerivationPort──▶
  RulebookDerivedDefinition ──validateRulebookDerivedDefinition──▶
  Level-2 rulebook fields (+ evidence-conflict surface)

Level-2 GUI fields ◀──resolveSources──merge──▶ Level-2 rulebook fields
  (additive; GUI keeps authoring position, rulebook-only fields append)

merged definition ──applyGenerationInstructions──▶ Level-1 structured ops
  (ProposedGenerationInstruction sequence; deterministic, order-preserving)

NormalizedSheetDefinition ──generateCharacterSheetSpec──▶ Level-3 final
  construction (bounded; name port only when the name is missing)

CharacterSheetSpec ──CharacterSheetSpecSchema + validateCharacterSheetSpecDomain──▶
  validated artifact
```

`generateNormalizedSheet` (`src/unified-service.ts`) orchestrates Level-2 and
Level-1; `generateCharacterSheetSpec` (`src/final-construction.ts`) owns
Level-3. The deterministic shared compiler (`src/compiler.ts`), layout
(`src/layout.ts`) and formula mapping (`src/formulas.ts`) are reused unchanged.

## Source authority

- **Level-2 sources are equal and additive.** GUI fields come from
  `normalizeGuiSource`; rulebook fields come from one provider derivation
  proposal whose evidence is validated against the real `RulesContext`.
- **Merge identity is `(category, canonicalKey)`.** Canonical keys are
  `canonicalizeFieldLabel` output — deterministic, conservative, never derived
  from model output, no synonyms or fuzzy matching.
- **Exact duplicates merge.** Same key+category with compatible definitions
  merge additively (GUI label preserved, rule evidence merged once).
- **Incompatible definitions never pick a silent winner.** Disagreements
  surface as conflicts: `EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT`,
  `DUPLICATE_CANONICAL_KEY_INCOMPATIBLE`, `INVALID_CONSTRAINT_VALUE`, and the
  first-arriving field is kept intact (never clipped, never overwritten).
- **Rulebook evidence is guarded.** A proposed field whose rule ids are not
  real normalized rules (`FABRICATED_RULE_EVIDENCE`) or whose citations do not
  belong to its referenced rules (`FOREIGN_CITATION_EVIDENCE`) is rejected as
  a visible conflict; citations are auto-derived from the referenced rules.
- **NPC mechanical fields never carry an explicit derived value.** The
  derivation boundary rejects them (`NPC_MECHANICAL_VALUE_FORBIDDEN`).

## Level-1 structured instructions

A bounded, machine-readable `ProposedGenerationInstruction` sequence applied
in order over the merged definition:

- `field` operations reuse the exact `ProposedSheetOverride` vocabulary
  (`add`, `remove`, `rename`, `replace`, `constrain`, `set_value`), resolved
  against canonical keys with deterministic target resolution and remap
  following;
- `set_character_name` can override a Level-2 name;
- `request_npc_portrait` is NPC-only and records a deferred portrait intent.

Mobile-phone note: Level-1 runs above the additive Level-2 sources but never
fabricates rulebook evidence, never rewrites formulas, and never silently
destroys a conflicting existing field. Rejections are recorded and listed.

## Character-name policy

- The GUI name is preserved exactly (trimmed; blank becomes `null` meaning no
  preference).
- A Level-1 `SET_CHARACTER_NAME` instruction overrides the GUI name.
- Only when the name is still missing does the Level-3 `Level3NamePort` run,
  with bounded retries (`SHEET_GENERATION_RETRIES`); empty or overlong results
  fail the construction (`invalid_character_name`), provider unavailability
  fails visibly (`name_provider_unavailable`).
- The character name is **never** the sheet title; `metadata.title` is always
  `Character Sheet` / `NPC Sheet`.
- **Known residue (2E):** `NormalizedSheetDefinition.characterName` is a bare
  string, so a Level-1 `SET_CHARACTER_NAME` origin is indistinguishable from
  GUI input at definition/spec level. The applied origin is only observable
  through `instructionResult.appliedInstructions`. Accepted as a documented
  boundary for this phase.

## NPC value policy

NPC mechanical fields resolve values deterministically from their permitted
range:

```text
value = min + THREAT_BIAS[threat] * (max - min)     (min < max)
value = min                                          (min == max)
bias: weak 0.25 | ordinary 0.50 | dangerous 0.75 | elite 0.90 | boss 1.00
bias = NEUTRAL 0.50 when no threat is defined (ally NPC)
```

Values always stay inside the stated range, never depend on a provider, and
are monotonic across threat levels for the same field shape.

## Grouping and titles

Section grouping and titles are server-owned and deterministic. Final
construction emits exactly two sections when their field sets are non-empty:
`Identity` and `Attributes` (Spanish `Identidad` / `Atributos` under an `es`
locale). No AI section plan and no AI field candidates participate. This
concludes the ADR-055 degeneracy investigation: provider-emitted titles are
not used in the final architecture.

## contextInstructions status

Free-text `contextInstructions` extraction is **deferred**. Raw request text
never enters the deterministic engine; only structured
`ProposedGenerationInstruction` objects do. A request carrying free-text
`contextInstructions` produces an identical definition and spec to one that
does not (benchmark scenario N).

## Rulebook limit

At most one READY `RulesContext` participates; derivation attempts at most
`SHEET_GENERATION_RETRIES` provider calls with validation feedback. No
rulebook means the derivation port receives zero calls. Provider unavailability
fails closed (`derivation_unavailable`); persistently invalid proposals fail
with `invalid_proposal`.

## Compilation and validation

- `compileCharacterSheet` maps symbolic field keys onto canonical ids,
  compiles bounded expressions (unknown references and formula cycles fail at
  compile time — surfaced as `compile_failed`), and produces deterministic
  placements/pages.
- The compiled artifact is parsed with `CharacterSheetSpecSchema` and
  domain-validated with `validateCharacterSheetSpecDomain` before it leaves,
  so an invalid spec never escapes (surfaced as `invalid_spec`).
- Fractional numbers are valid for number fields; no integer `step` is imposed
  unless the range schema supplies one.

## Boundaries and deferred work

- `apps/rules-worker` character-sheet files still sit on the old superseded
  run pipeline (mandatory `RulesContext`, old `SheetGenerationPort` stages,
  `SHEET_GENERATION_MODEL`). Rewiring them to the 2E pipeline is Phase 14.7
  integration work, not part of this phase.
- D1 `sheet_generation_runs` requires `analysis_id`, `rules_analysis_run_id`
  and `ingestion_id` (`NOT NULL`), so GUI-only generation without a rulebook is
  blocked at the persistence layer — Phase 14.7 debt.
- The run lifecycle repository and R2 artifact store are reusable
  infrastructure but were built for the old run model.

## Verification

The phase ships a deterministic domain benchmark at
`packages/character-sheet-generation/src/benchmark/phase-14.5-domain.test.ts`
covering scenarios A–N: GUI-only PC/NPC, rulebook-only PC/NPC, combined
sources with Level-1 `REMOVE`/`REPLACE`, equal-authority conflict surfacing,
character-name authority, blank-name name-port fallback and failure, monotonic
NPC threat bias, formula validity/unknown/cycle/depth/explicit-value
boundaries, localization, presentation isolation, and inert free-text
`contextInstructions`. All tests use deterministic fixtures and fake providers.

## Related ADRs

- ADR-005 — AI provider abstraction
- ADR-012 — Workers AI binding
- ADR-054 — Zod 4 as canonical runtime and JSON Schema source
- ADR-055 — Section-plan title degeneracy (superseded in part)
- ADR-056 — Deterministic character-sheet construction
