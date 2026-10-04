# ADR-058 — Character Sheet Spatial Draft Layout

**Status:** Accepted
**Date:** 04/10/2026

## Context

Phase 14.7 closed with a stable canonical `CharacterSheetDraft` V2 runtime:
content registries, recursive Section hierarchy, canonical `structure[]`
preorder, `place_node` before/after/inside domain semantics, Worker/Web/R2/D1
persistence, `expectedVersion` concurrency, confirm/read-only, historical V1
read compatibility, and browser + workerd E2E.

The North Star requires the user — not AI — to own sheet content, hierarchy,
**and spatial arrangement**, with the confirmed Draft authoritative and AI
presentation a later decoration. V2 expresses what exists and in what order,
but not grid intent, so Phase 14.9 cannot build the real visual Canvas on it.
The current `projectDraftV2ToSpec()` hardcodes single-column geometry,
silently discarding any richer intent.

## Decision

Extend canonical V2 with an OPTIONAL, independently versioned spatial
contract instead of a V3 draft:

- The draft stays `schemaVersion: "2"`; the new field is
  `layout?: DraftLayoutV1` with `layout.schemaVersion === "1"`.
- Historical V2 snapshots (no layout) stay valid with no cutover; V1 → V2
  migration output stays layoutless and readable.
- The spatial submodel versions independently (`DraftLayoutV1`) and may evolve
  without touching the draft version.

**Authority split.** `structure[]` remains the ONLY hierarchy/order
authority. Layout carries no `parentKey`, no children, no sibling ordering,
no alternative tree. It is structured/grid-based only: containers declare
column counts (Root + every Section, so grids nest), nodes declare
`columnStart`/`columnSpan`/`rowSpan`/`breakBefore` relative to their CURRENT
parent container. No absolute `x`/`y`/`width`/`height`, no second order value,
no `rowStart` in 14.8. Rows are deterministic auto-flow over canonical
sibling order plus geometry — the semantics the Spec/PDF grid engine already
implements.

**Bounds.** Containers allow 1..4 columns and nodes `rowSpan` 1..12, mirroring
the flat `CharacterSheetSpec` (`MAX_LAYOUT_COLUMNS = 4`, `MAX_ROW_SPAN = 12`)
and the PDF renderer's four-column grid. One bound in three places by
deliberate mirroring (documented, not refactored): 14.8 establishes the
contract, not capacity expansion.

**Completeness.** An explicit layout must be complete: every Section has
exactly one container entry, every structural node exactly one node entry, and
every geometry must fit its current parent container. No silent repair, no
silent clamping — validation, moves, and column reductions fail closed.
Layoutless drafts resolve through the single package authority
`resolveEffectiveDraftLayoutV1` to deterministic defaults (1 column, 1x1,
no break), exactly preserving pre-14.8 behavior, without mutating the draft.

**Mutations.** `set_container_layout` and `set_node_layout` join the existing
`DraftMutationV2` union (now thirteen operations) through the same
`expectedVersion`/confirmed/no-op/N+1 machinery; no new HTTP routes. Existing
mutations maintain layout (add_* extend it, remove_field prunes it,
content/rename/reroll/confirm preserve it), and `place_node` preserves valid
geometry but rejects moves whose preserved geometry no longer fits — a move
and a geometry change stay separate user intentions.

**Projection fidelity.** `projectDraftV2ToSpec()` projects effective layout
(container columns per run context, node geometry per field) and fails closed
(`projection_invalid`) on Section-node geometry the flat spec cannot
represent, instead of silently flattening spatial intent. The technical PDF
renderer already honors placement, so representable layouts export unchanged.

**Preview.** `SheetPreviewV2` renders the draft layout directly as nested CSS
grids (read model for hierarchy, effective layout for geometry), read-only,
with no projection gate and no Canvas interaction.

## Alternatives considered

- **Draft V3 for layout.** Rejected: it would force a schema cutover for an
  additive, optional capability and orphan layoutless history.
- **Absolute pixel geometry.** Rejected: device-dependent, unvalidatable
  against the grid engine, and hostile to deterministic auto-flow.
- **Second ordering inside layout.** Rejected: two order authorities diverge;
  structure[] stays sole.
- **Silent clamping on shrink/move.** Rejected: it rewrites user intent
  behind the user's back; 14.9 orchestrates move+geometry explicitly.

## Consequences

- Phase 14.9 builds the visual Canvas on `DraftLayoutV1` + `place_node`
  without a new persisted contract; before/after DnD UI, resize handles, and
  `remove_section`/Undo remain explicitly out of scope.
- Extraction compiles deterministic default layout (no spatial evidence in
  the current DTO; geometry is never invented); enrichment waits for real
  evidence.
- Durable numeric layout controls ship now and remain as precise/
  accessibility fallbacks after the Canvas lands.
- Workerd integration proves explicit-layout round-trips and
  layoutless → spatial next versions with immutable history.
