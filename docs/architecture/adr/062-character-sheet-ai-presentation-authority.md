# ADR-062 — Character Sheet AI Presentation Authority

**Status:** Accepted
**Date:** 2026-10-14

## Context

Phase 14.11 established the final-generation contract: a confirmed Draft plus
generation metadata. Phase 14.12 must turn that contract into a real product
flow — AI-planned presentation, deterministic value resolution, and a styled
final PDF — without giving the model any authority over game content.

Key constraints:
- Draft V2 is server-authoritative; the client holds optimistic preview only.
- The production HTTP request must not trust a client-supplied Draft snapshot.
- NPC mechanical values must be deterministic and style-independent.
- The flat CharacterSheetSpec adapter cannot represent recursive Draft
  geometry and must not be the final-product path.

## Decision

### 1. AI owns bounded presentation tokens only

`FinalPresentationPlanV1` carries exactly:

- `style`: `medieval` | `sci-fi` (the 14.12 implemented subset)
- `variant`, `ornamentDensity`, `contrast`, `sectionEmphasis`, `fieldEmphasis`
  (all finite application-owned enums)

The model can never output colors, fonts, CSS, HTML, SVG text, coordinates,
field data, labels, values, sections, or fields. Unknown tokens fail schema
validation. At most one bounded repair attempt is allowed.

### 2. StyleProfile owns actual rendering

`StyleProfileV1` (Medieval, Sci-fi) is application code and the sole authority
for typography, palette, page frame, section/field treatment, background
treatment, ornament primitives, allowed variants, and forbidden
transformations. The deterministic renderer maps bounded plan tokens plus the
profile to visual primitives.

### 3. Structural summary is the only AI input besides style and instructions

`StructuralSummaryV1` carries mode, field/section counts, max nesting depth,
root columns, layout presence, and density. Raw Draft values are never sent.
User instructions travel in the untrusted user-data channel; the trusted
system prompt declares presentation-only authority and forbids obeying
requests for value/field/layout changes.

### 4. Resolved values are derived output, never Draft mutation

`FinalResolvedValuesV1` is computed per run from the authoritative Draft. PC
blanks never generate. In 14.12, NPC generation is limited to blank NUMBER
fields with complete min/max ranges, sampled deterministically from the
canonical threat bias, generation seed, and field key (reusing the existing
threat-sampling policy). Style never reaches the resolver.

### 5. The final renderer is Draft-native

`renderStyledCharacterSheetPdf` consumes the Draft, effective layout, resolved
values, plan, and profile directly. Hierarchy/order come from
`draft.structure`; geometry comes from the effective `DraftLayoutV1`. Extreme
layouts fail closed with a typed error. The renderer emits a manifest whose
semantic portion is style-invariant and whose presentation portion records
the style.

### 6. Server builds the canonical request; runs reuse existing infrastructure

The Worker loads the authoritative Draft, verifies the expected version and
confirmed state, and builds `FinalGenerationRequestV1` server-side. Runs reuse
`sheet_generation_runs` and the existing R2 key layout; the artifact port
gains a narrow `putPdfBytes` so no lossy `CharacterSheetSpec` is manufactured.
Orchestration is synchronous: PENDING → READY, or PENDING → FAILED with
best-effort artifact cleanup and no partial PDF exposure.

## Alternatives considered

- **AI returns full styled markup** — rejected: unbounded output cannot be
  validated, styled, or printed deterministically.
- **AI generates NPC stats freely** — rejected: inventing mechanics violates
  system-agnosticism; 14.12 limits generation to safely bounded numerics.
- **Final path through CharacterSheetSpec** — rejected: the flat adapter
  cannot represent recursive geometry; a Draft-native renderer is required.
- **New run/history tables** — rejected: existing temporary session-scoped
  run infrastructure is reused; no persistent generation history.
- **Client-supplied Draft authority** — rejected: production generation loads
  the authoritative Draft server-side.

## Consequences

- Medieval and Sci-fi produce byte-distinct PDFs with deep-equal semantic
  manifests from the same canonical Draft.
- The old Spec renderer remains as the technical/compatibility path.
- Portrait stays deferred to 14.13; richer NPC mechanics stay deferred
  to 14.14.
- No real inference runs in automated tests; missing AI bindings fail closed.
