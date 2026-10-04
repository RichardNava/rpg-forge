# Phase 14.8 Character-Sheet Spatial Authoring Foundation

**Status:** CURRENT (14.8 delivered; 14.7 CLOSED)
**Date:** 2026-10-04

**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Decision record:** `docs/architecture/adr/058-spatial-draft-layout.md`
**Phase status labels:** CURRENT / COMPLETED / SUPERSEDED / DEFERRED

## Purpose

Phase 14.8 adds a persistent, authoritative spatial layout model to the stable
canonical `CharacterSheetDraft` V2 runtime, so a Draft expresses what nodes
exist, hierarchy, canonical structural order, AND spatial/grid intent. Phase
14.9 builds the real visual Canvas on this contract; 14.8 deliberately builds
no Canvas, no before/after DnD UI, no resize handles, and no freeform
interaction.

Product direction (North Star): the user defines content, hierarchy, and
spatial arrangement; the confirmed Draft is authoritative; later AI
presentation decorates that Draft without replacing or reinterpreting
structure, layout, or explicit values.

## What 14.8 delivered [COMPLETED]

```text
DraftLayoutV1                          (@repo/character-sheet-draft/draft-layout-v1)
  → optional draft.layout               (draft stays schemaVersion "2")
  → resolveEffectiveDraftLayoutV1       (single defaults authority)
  → set_container_layout / set_node_layout (DraftMutationV2: 11 → 13 ops)
  → existing-mutation layout maintenance (add/remove/place/rename/reroll/confirm)
  → projectDraftV2ToSpec fidelity       (effective geometry or fail closed)
  → SheetPreviewV2 nested CSS grids     (read-only, no projection gate)
  → durable numeric layout controls     (root/section/field, store-driven)
  → explicit layout on creation         (fixtures, extraction compiler)
  → Worker/R2/D1 unchanged shape       (same routes, same keys, same heads)
  → workerd + Playwright integration    (round-trips, compat bridge, browser flow)
```

## Contract summary

- **Versioning.** Draft stays `schemaVersion: "2"`; `layout.schemaVersion`
  is `"1"` and evolves independently. Optional field keeps all historical
  V2 (and migrated V1) snapshots valid with no cutover.
- **Authority split.** `structure[]` is the ONLY hierarchy/order authority.
  Layout holds containers (`root` + per-Section `columns`) and per-node
  `columnStart`/`columnSpan`/`rowSpan`/`breakBefore` — no `parentKey`, no
  children, no ordering, no pixels, no `rowStart`.
- **Bounds.** Containers 1..4 columns, `rowSpan` 1..12, mirroring the flat
  `CharacterSheetSpec` and the PDF renderer grid. One bound in three places
  by deliberate mirroring (see ADR-058), not a refactor.
- **Completeness.** Explicit layout must cover every Section container and
  every structural node, with each geometry fitting its current parent
  container. No silent repair, no silent clamping — anywhere.
- **Defaults.** Layoutless drafts resolve to single-column, 1x1, no-break
  defaults without mutation, exactly preserving pre-14.8 behavior.
- **Moves vs geometry.** `place_node` preserves valid geometry and rejects
  incompatible destinations; shrinking a container with unfitting children
  rejects. Structural moves and geometry changes stay separate intentions
  for 14.9 to orchestrate.
- **Projection.** Effective geometry projects where the flat spec can
  represent it (per-context columns, per-field placement); non-default
  Section-node geometry fails closed with `projection_invalid`. The technical
  PDF preserves representable geometry through the existing renderer.
- **Compatibility.** Historical V1 still canonicalizes in memory and is never
  rewritten; layoutless V2 reads stay byte-identical; the next write after a
  layout mutation is the first explicit-layout version.

## Boundaries (unchanged by 14.8)

- HTTP namespace stays `/v1/character-sheets`; no layout-specific routes.
- R2 key layout unchanged; D1 head/version semantics unchanged; no new
  tables.
- `expectedVersion` concurrency and confirmed immutability unchanged,
  including for spatial mutations.
- Turnstile remote fail-closed, same-origin proxy whitelist, identity path
  validation, R2 tenant isolation unchanged.
- Extraction compiles deterministic default layout: the DTO carries
  hierarchy without reliable grid evidence, so geometry is never invented.
  Spatial enrichment waits for real evidence.

## Explicitly deferred to 14.9+

Visual Canvas, before/after DnD UI, resize handles, freeform positioning,
`remove_section`, Undo, new Field types, threat-level contract, NPC AI,
visual-style generation, portrait upload/URL/AI, Generate-with-AI handoff,
final ornamented PDF.

## Related documents

- ADR-058 — Character Sheet Spatial Draft Layout
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- `docs/architecture/phase-14.7/character-sheet-integration.md` (14.7 history)
- `docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md`
  (frozen V2 transport; 14.8 adds union members, not envelopes)
- Phase 14.6 — Character-Sheet PDF Renderer (technical renderer)
- Phase 14.5 — Character-Sheet Generation
