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
  placement, and NPC mechanical values. NPC mechanical values are populated by
  a **deterministic seeded pseudo-random** draw (no `Math.random`, no AI
  provider): the same seed/run with the same inputs reproduces the same
  values; different seeds may vary eligible values; every sampled value stays
  inside the field's effective bounds; explicit and fixed (`min == max`) user
  values always win; unbounded/non-numeric fields are never invented. Threat
  biases the distribution (the `boss` tier has the strongest high-end bias but
  never forces `max`). The seed is ignored for PC mechanical values. A name
  provider is consulted only when the level-2/1 definitions leave the
  character name missing, with bounded retries and a visible failure for
  unavailability or invalid output.
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

## Implementation status (Phase 14.7A)

The deferred/blocking statements above are resolved or narrowed as follows,
without changing the historical rationale:

- **GUI-only no longer requires a synthetic RulesContext identity.** A
  GUI-only `CharacterSheetSpec` now carries `rulesContextId = null` and a
  genuine `metadata.id`, and is never minted without an explicit `sheetId`
  (14.7A1). `rulesContextId` is required-nullable in the canonical schema.
- **Persistence rulebook identities are nullable.** The D1
  `sheet_generation_runs` `NOT NULL` constraints cited above were removed by
  additive migration 0003: `analysis_id`, `rules_analysis_run_id` and
  `ingestion_id` are nullable, so GUI-only runs persist without rule-analysis
  rows (14.7A2).
- **Final run currency is sheet-session scoped.** Generation runs belong to
  temporary sheet sessions (`@repo/character-sheet-session`) with at most one
  current run per session and repost-supersede semantics, not to the legacy
  mandatory-`RulesContext` analysis pipeline (14.7A2).
- The legacy worker pipeline rewiring is now scheduled as 14.7D (HTTP
  orchestration) and remains unimplemented; free-text `contextInstructions`
  extraction remains deferred.

### Phase 14.7C addendum

- **Template-backed construction is now a first-class input.** A blank sheet
  template (`@repo/character-sheet-template`, extraction port +
  `extractSheetTemplate`) normalizes into validated `SourceResolvedFields`
  (`normalizeTemplateFields`) and acts as the field-roster authority; the GUI
  authoring request overlays values on top (`overlayTemplateWithGui`).
  Incompatible template/GUI bounds and categories surface as visible conflicts
  (`TEMPLATE_BOUND_DISAGREEMENT`, `TEMPLATE_CATEGORY_DISAGREEMENT`) exactly as
  equal-authority Level-2 disagreements do.
- **The character-name absent-fallback gained a provider-free default.**
  `DeterministicLocalNamePort` is a seeded, locale-aware, syllable-based local
  source adapted to the Level-3 contract
  (`createDeterministicLevel3NamePort`). The same `(mode, seed, locale)`
  triple yields the same name, and the standalone flow never consumes
  inference quota for a name. This resolves the ADR's earlier "no production
  `Level3NamePort` adapter exists" statement for the standalone path.
- **NPC mechanical population is seeded and threat-biased, not a fixed
  percentile.** `resolveNpcValue` draws deterministically from the shared
  `deterministic.ts` PRNG (no `Math.random`) inside a window centered on the
  tier's `THREAT_BIAS` (see the Decision above): same seed → same values,
  different seed → in-bounds variation, explicit/fixed values always win, and
  `boss` keeps a high-end bias without forcing `max`. The seed is threaded
  through the template-backed flow (`generateTemplateBackedSheet → final
construction`) and defaults to `sheetId`/`"template-backed"`. It never
  affects PC mechanical values, which still resolve only from explicit values.
- **The production multimodal template extractor is blocked** on a committed
  vision model (none exists in configuration; see the phase 14.7 doc). The
  reference extractor keeps the extraction surface tested offline.
- `RulebookFieldDerivationPort` is retained but regarded as legacy/superseded
  for the production template-backed flow.

## Related ADRs

- ADR-005 — AI provider abstraction
- ADR-012 — Workers AI binding
- ADR-054 — Zod 4 as canonical runtime and JSON Schema source
- ADR-055 — Section-plan title degeneracy (superseded in part)
