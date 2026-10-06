# Phase 14.9 Character-Sheet Visual Canvas / Complete DnD

**Status:** COMPLETED (14.9 delivered; 14.8 CLOSED)
**Date:** 2026-10-06
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Decision record:** `docs/architecture/adr/059-visual-canvas-direct-manipulation.md`
**Phase status labels:** CURRENT / COMPLETED / SUPERSEDED / DEFERRED

## Purpose

Phase 14.9 builds the real visual Canvas on the spatial contract established in 14.8. The Canvas is the primary authoring surface for the Character Sheet Generator; the Inspector is the precision/accessibility companion. Both read from the single canonical structural read model and effective layout — no shadow structural state, no duplicate traversal.

## What 14.9 delivered [COMPLETED]

```text
SheetCanvasV2                         (apps/web/src/features/character-sheets/components/canvas/)
  → before / after / inside DnD
  → explicit intent rails (canvas:before:field:key, canvas:after:section:key, canvas:inside:sectionKey|root)
  → collision: rails → section bodies (smallest-area) → root zone
  → empty Section pointer targets (grid-auto-rows: minmax(6rem, auto))
  → DragOverlay + screen-reader announcements

CanvasInspectorV2                     (precision/accessibility companion)
  → Sheet overview (root columns)
  → Field inspector (label, type, value, position, move menu, remove)
  → Section inspector (title, parent, columns, position, move menu)
  → mini-grid occupancy + numeric controls (store-driven)
  → move menu (valid destinations only)

shared spatial rendering
  → useSpatialSurface → buildDraftStructuralReadModelV2 + resolveEffectiveDraftLayoutV1
  → SpatialNodes (single traversal shared by Preview and Canvas)
  → nested CSS Grids (container + item geometry + break-before breakers)

resize handles
  → E / S / SE handles on selected node (mouse gestures + keyboard sliders)
  → preview locally, ONE set_node_layout on mouse-up
  → keyboard sliders: ArrowRight/Left/Up/Down, Home/End

keyboard move flow
  → Space/Enter on handle opens modal menu
  → valid destinations only (before/after siblings, inside sections, root)
  → Enter commits, Escape cancels + restores focus to handle
  → screen-reader instructions included

empty Section pointer drop
  → grid-auto-rows: minmax(6rem, auto) on .canvas-section-body
  → empty section body has deterministic rect for pointerWithin

collision detection
  → rails first (pointerWithin)
  → section bodies smallest-area-first (pointerWithin)
  → root zone last
  → fallback: closestCenter (no pointer coords / keyboard drag)

confirmed state
  → no handles, no rails, no resize, no inspector editing affordances
  → layout remains visible and identical
```

## Contract summary

- **Canvas is the primary authoring surface.** Inspector is the precision/accessibility companion. Both derive from `useSpatialSurface` → canonical read model + effective layout.
- **No shadow structural state.** Canvas never builds its own tree; it traverses the canonical read model via `SpatialNodes`. No duplicate tree, no layout inference, no copied geometry.
- **Complete before/after/inside DnD.** Explicit intent rails (`canvas:before:field:key`, `canvas:after:section:key`, `canvas:inside:sectionKey|root`) replace pointer-position heuristics. Collision: rails → section bodies (smallest area) → root zone.
- **Empty Section pointer targets work.** Empty section body has `grid-auto-rows: minmax(6rem, auto)` ensuring a measurable rect for `pointerWithin`; the inside droppable ref is on the visual body, not the wrapper.
- **Explicit intent rails.** Each insertion rail (`before`/`after`) and container (`inside`) is a separate droppable with a stable ID. Geometry is not inferred from pointer position; intent travels via droppable data into announcements and `resolveDropDestination`.
- **Direct grid resize.** E/S/SE handles on selected node only. Mouse gestures preview locally; ONE `set_node_layout` commit on mouse-up; Escape/mouse-cancel discards preview. Keyboard sliders (arrows/Home/End) on handles + Inspector numerics cover the corner.
- **Keyboard/non-pointer move flow.** Space/Enter on handle opens modal menu with pre-validated destinations (before/after siblings, inside sections, root). Enter commits, Escape cancels + restores focus. Screen-reader instructions included in dnd-kit accessibility config.
- **Empty Section pointer drop works.** `grid-auto-rows: minmax(6rem, auto)` on `.canvas-section-body` gives empty sections a measurable rect for `pointerWithin`. The inside droppable ref is on the visual body (`.character-workshop__canvas-scroll`), not the section wrapper.
- **Empty Section pointer drop is implemented.** `grid-auto-rows: minmax(6rem, auto)` on `.canvas-section-body` gives empty sections a measurable rect for `pointerWithin`. The inside droppable ref is on the visual body (`.character-workshop__canvas-scroll`), not the section wrapper.
- **Canvas interaction state is ephemeral.** Selection, drag/hover/resize-preview/menu/error are local React state; they never become authority. Drops and resizes commit exactly once; hover commits nothing.
- **Shared spatial rendering.** Both `SheetPreviewV2` (read-only) and `SheetCanvasV2` (editable) use `useSpatialSurface` → `buildDraftStructuralReadModelV2` + `resolveEffectiveDraftLayoutV1`. Single `SpatialNodes` traversal; nested CSS Grid semantics identical.
- **Resize is grid-snapped.** `snapColumnSpan` / `snapRowSpan` pure functions convert pointer deltas to integer spans against measured column/row units. Preview updates on `mousemove`; ONE `set_node_layout` on `mouseup`; `Escape` discards preview.
- **Keyboard move flow is equivalent.** Space/Enter on drag handle opens modal menu with pre-validated destinations. Enter commits through `place_node`; Escape cancels + restores focus. Screen-reader instructions included in dnd-kit accessibility config.
- **Inspector mirrors Canvas capabilities.** Sheet overview (root columns), Field/Section inspectors with mini-grid + numeric controls + move menu. All store-driven; confirmed state removes editing affordances while layout remains visible.
- **DragOverlay + announcements.** dnd-kit `DragOverlay` shows "Moving {label} {kind}"; `canvasAnnouncements` provide human-readable pickup/hover/cancel messages with sheet labels.
- **Confirmed state removes all affordances.** No handles, rails, resize, inspector editing, or inputs; layout stays visible and identical.
- **No shadow structural state anywhere.** Canvas derives from canonical read model; Inspector reads from canonical read model; Preview renders from canonical read model. One traversal, one authority.

## Boundaries (unchanged by 14.9)

- HTTP namespace stays `/v1/character-sheets`; no layout-specific routes.
- R2 key layout unchanged; D1 head/version semantics unchanged; no new tables.
- `expectedVersion` concurrency and confirmed immutability unchanged, including for spatial mutations.
- Turnstile remote fail-closed, same-origin proxy whitelist, identity path validation, R2 tenant isolation unchanged.
- Extraction compiles deterministic default layout (no spatial evidence in current DTO); enrichment waits for real evidence.
- Spatial layout bounds: Root/Section containers 1..4 columns; node `rowSpan` 1..12; bounds validated in mutations, never silently clamped.

## Explicitly deferred to 14.10+

- `remove_section` mutation (safe semantics: empty Section may be removed, non-empty rejected)
- Undo (server-authoritative, version-aware, `expectedVersion` conflict protection)
- Visual style selection / rendering
- Character image (upload / URL / AI)
- Preview as modal (currently live preview pane)
- `remove_section` safe semantics (empty Section may be removed, non-empty rejected)
- Undo (server-authoritative, version-aware, `expectedVersion` conflict protection)
- Visual style selection / rendering
- Character image (upload / URL / AI)
- Preview as modal (currently live preview pane)
- Final ornamented PDF generation

## Related documents

- ADR-059 — Visual Canvas Direct Manipulation Architecture
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- `docs/architecture/phase-14.8/character-sheet-spatial-authoring.md` (14.8 foundation)
- ADR-058 — Character Sheet Spatial Draft Layout (14.8 foundation)
- `docs/architecture/phase-14.7/character-sheet-integration.md` (14.7 history)
- Phase 14.7 V2 transport contract (frozen for cutover)

(End of file - total 107 lines)
