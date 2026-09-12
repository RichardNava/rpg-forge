# ADR-056 — Deterministic character-sheet final construction

**Status:** Accepted
**Date:** 12/09/2026

## Context

Character-sheet generation must inherit the ADR-005 provider abstraction but
remain deterministic where a provider adds no value. Phase 14.5 fuzz work
demonstrated that provider-emitted content — especially section titles and
free-form candidates — is unreliable (see ADR-055). The final construction of
a `CharacterSheetSpec` therefore must not depend on a model for structural
decisions: grouping, titles, formula mapping, ordering, and NPC mechanical
values are deterministic.

Two further decisions were in play for the phase closeout:

1. **Source authority.** The generator accepts an optional single READY
   `RulesContext` (rulebook). The rulebook must influence real mechanical
   content without silently defeating explicit GUI authoring, and without
   fabricating evidence that does not exist in the real normalized rules.
2. **Instruction shape.** Request-level guidance (`contextInstructions`) is
   free text. A free-text path would reintroduce a model into the core merge,
   and its extraction is not yet proven.

## Decision

- **Level-2 GUI source is deterministic.** The GUI authoring request is
  normalized without any model (`normalizeGuiSource`).
- **Level-2 rulebook source is additive.** At most one READY `RulesContext`
  may be derived, through the `RulebookFieldDerivationPort`, into a validated
  `RulebookDerivedDefinition`. Fabricated or foreign rule evidence is rejected
  as a visible conflict; NPC mechanical fields never carry an explicit derived
  value.
- **Equal authority with visible conflict.** GUI and rulebook fields merge on
  `(category, canonicalKey)`. Incompatible definitions never pick a silent
  winner (`EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT` and friends); the
  first-arriving field is kept intact, never clipped or overwritten.
- **Level-1 structured instructions.** Only machine-readable
  `ProposedGenerationInstruction` objects reach the engine, applied in order.
  Free-text `contextInstructions` extraction is **deferred**; raw request text
  never enters the deterministic engine. Level-1 never fabricates rulebook
  evidence and never rewrites formulas.
- **Level-3 final construction is bounded.** `generateCharacterSheetSpec`
  determines grouping, localized canonical titles, formula mapping, page
  placement, and NPC mechanical values (`value = min + THREAT_BIAS[threat] ·
(max - min)`, in-range). A name provider is consulted only when the level-2/1
  definitions leave the character name missing, with bounded retries and a
  visible failure for unavailability or invalid output.
- **The shared deterministic compiler is reused.** Cycles and unknown field
  references already fail at compile time; compiled output is parsed with the
  canonical schema and domain-validated before it leaves the phase boundary.
- **No provider call for structural content.** The two provider ports
  (rulebook derivation, character-name absent-fallback) are exercised in
  automated tests exclusively with fake providers.

## Consequences

- Structural output is stable and reproducible: identical inputs produce
  identical specs, independent of model availability, model choice, or
  inference nondeterminism.
- GUI-only, rulebook-only, and combined generation all flow through one
  additive merge, so the worker's legacy mandatory-`RulesContext` run pipeline
  is superseded and needs rewiring in a later integration phase (Phase 14.7).
- D1 `sheet_generation_runs` `NOT NULL` constraints (`analysis_id`,
  `rules_analysis_run_id`, `ingestion_id`) block GUI-only persistence until
  that integration phase.
- The character name is a bare string at definition level; the Level-1
  `SET_CHARACTER_NAME` origin is only observable via
  `instructionResult.appliedInstructions`. This is an accepted, documented
  residue, not a correctness gap.
- ADR-055's title degeneracy is resolved structurally: section grouping and
  titles are server-owned; no section-plan persona delta was promoted.

## Related ADRs

- ADR-005 — AI provider abstraction
- ADR-012 — Workers AI binding
- ADR-054 — Zod 4 as canonical runtime and JSON Schema source
- ADR-055 — Section-plan title degeneracy (superseded in part)
