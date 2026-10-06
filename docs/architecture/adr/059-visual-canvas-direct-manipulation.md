# ADR-059 — Visual Canvas Direct Manipulation Architecture

**Status:** Accepted
**Date:** 06/10/2026

## Context

Phase 14.8 established the authoritative spatial layout model (`DraftLayoutV1`) as an optional, independently versioned field on the canonical `CharacterSheetDraft` V2. The contract includes:

- Root/Section grid containers (1..4 columns)
- Per-node grid geometry (`columnStart`, `columnSpan`, `rowSpan`, `breakBefore`)
- `resolveEffectiveDraftLayoutV1` as the single defaults authority
- `place_node` / `set_container_layout` / `set_node_layout` mutations
- `resolveEffectiveDraftLayoutV1` + `buildDraftStructuralReadModelV2` as the single read surface
- `SheetPreviewV2` rendering nested CSS grids from that surface

Phase 14.9 must build the real visual Canvas on this contract. The Canvas is the primary authoring surface; it must support complete before/after/inside DnD, direct grid resize, and keyboard-accessible moves — all translating directly into the canonical V2 mutations without introducing a second persisted structure/layout authority.

## Decision

### 1. Canvas derives from canonical read model + effective layout

The Canvas **never** builds a shadow tree or copies geometry. It uses `useSpatialSurface` → `buildDraftStructuralReadModelV2` + `resolveEffectiveDraftLayoutV1` → single `SpatialNodes` traversal. Both `SheetCanvasV2` (editable) and `SheetPreviewV2` (read-only) share this exact rendering layer. There is no second structural authority.

### 2. Explicit intent rails replace pointer-position heuristics

Every insertion point (`before`/`after` a sibling, `inside` a Section/Root) is a separate droppable with a stable ID (`canvas:before:field:key`, `canvas:after:section:key`, `canvas:inside:sectionKey|root`). Pointer position never infers intent; the droppable ID is the intent. Collision detection prioritizes: rails → section bodies (smallest area) → root zone. Geometry is never inferred from pointer position.

### 3. Canvas interaction state is ephemeral

Selection, drag/hover/resize-preview/menu/error are local React state only. They never become authority. Drops and resizes commit exactly once via canonical mutations (`place_node`, `set_node_layout`); hover commits nothing. No shadow structural state ever exists.

### 4. Direct grid resize commits exactly once

E/S/SE handles on the selected node. Mouse gestures preview locally (parent-owned preview state); ONE `set_node_layout` on `mouseup`; `Escape`/`mouse-cancel` discards preview. Keyboard sliders (arrows/Home/End) on handles + Inspector numerics cover the corner.

### 5. Empty Section pointer targets are first-class

Empty Section bodies have `grid-auto-rows: minmax(6rem, auto)` ensuring a measurable rect for `pointerWithin`. The inside droppable ref lives on the visual body (`.character-workshop__canvas-scroll`), not the section wrapper. Empty Sections are valid drop targets for both Fields and Sections.

### 5. Empty Section pointer targets work reliably

Empty Section bodies have `grid-auto-rows: minmax(6rem, auto)` ensuring a measurable rect for `pointerWithin`. The inside droppable ref lives on the visual body (`.character-workshop__canvas-scroll`), not the section wrapper. Empty Sections are valid drop targets for both Fields and Sections. Pointer drag into empty Sections works reliably.

### 6. Keyboard/non-pointer move flow is equivalent

Space/Enter on drag handle opens modal menu with pre-validated destinations (before/after siblings, inside sections, root). Enter commits via `place_node`; Escape cancels + restores focus to originating handle. Screen-reader instructions included in dnd-kit accessibility config.

### 7. Inspector is the precision/accessibility companion

Sheet overview (root columns), Field/Section inspectors with mini-grid + numeric controls + move menu. All store-driven; confirmed state removes editing affordances while layout remains visible. No duplicate logic; Inspector reads from the same `useSpatialSurface` + canonical read model.

### 8. Shared spatial rendering is mandatory

Both `SheetPreviewV2` (read-only) and `SheetCanvasV2` (editable) use `useSpatialSurface` → `buildDraftStructuralReadModelV2` + `resolveEffectiveDraftLayoutV1` → single `SpatialNodes` traversal with nested CSS Grid semantics. No duplicate traversal, no duplicate tree, no layout inference.

### 9. Durable numeric layout controls ship with the Canvas and remain after

Root/Section columns + node column start/span, row span, break-before. Store-driven; read-only after confirm; remain as accessibility fallback after Canvas lands. They are not throwaway UI.

### 10. Canvas interaction state never becomes a second authority

Selection, drag/hover/resize-preview/menu/error are local React state. Drops and resizes commit exactly once via canonical mutations. Hover commits nothing. The confirmed state removes all affordances while layout remains visible and identical.

## Alternatives considered

- **Shadow Canvas tree with sync to Draft.** Rejected: two structural authorities diverge; sync bugs inevitable; defeats single-authority contract.
- **Pointer-position-based DnD (no explicit rails).** Rejected: ambiguous intent in nested containers; rails resolve ambiguity deterministically.
- **Absolute pixel geometry for resize.** Rejected: device-dependent, unvalidatable against the grid engine, hostile to deterministic auto-flow.
- **Per-pointermove store mutations.** Rejected: excessive writes, race conditions, no preview/discard semantics.
- **Empty Section body with zero height.** Rejected: `pointerWithin` never matches zero-height rect; empty Sections would be undroppable by pointer.
- **Keyboard move as second-class fallback.** Rejected: accessibility requirement; keyboard flow must reach exactly the same outcomes as pointer.

## Consequences

- Phase 14.9 Canvas is the primary authoring surface; Inspector is the precision/accessibility companion. Both derive from the same canonical surface.
- Empty Sections are valid pointer drop targets without special-casing.
- Resize handles are mouse-based (TouchSensor covers touch drag for DnD); keyboard sliders + Inspector numerics cover accessibility.
- Keyboard move flow reaches exactly the same outcomes as pointer DnD.
- Inspector remains as precision/accessibility fallback after Canvas lands.
- Confirmed state removes all affordances while layout remains visible.
- No shadow structural state anywhere — Canvas, Inspector, and Preview share the single canonical surface.
- Phase 14.10 will add `remove_section`, Undo, visual styles, character image, modal preview, and final ornamented PDF.

## Non-goals

- No second structural authority, no shadow tree, no copied geometry.
- No per-pointermove store mutations.
- No absolute pixel geometry.
- No silent clamping/repair of geometry on move or shrink.
- No separate Root organizer/tree.
- No freeform pixel positioning — grid intent only.
- No persistent shadow state for hover/drag/preview/menu/error.

(End of file - total 161 lines)
