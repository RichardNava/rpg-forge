# Phase 14.10 Character-Sheet Authoring Completeness

**Status:** COMPLETED (14.10 delivered)
**Date:** 2026-10-12
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Decision record:** `docs/architecture/adr/060-server-authoritative-character-sheet-undo.md`
**Phase status labels:** CURRENT / COMPLETED / SUPERSEDED / DEFERRED

## Purpose

Phase 14.10 completes the MVP Field authoring surface for the Character Sheet Generator. It adds the remaining MVP field types, safe configuration editing, safe deletion semantics, and one-level server-authoritative Undo — all built on the 14.9 visual Canvas architecture without redesigning it.

## What 14.10 delivered [COMPLETED]

```
MVP Field Types (all seven user-authorable)
  → Label (static display, no value)
  → Text
  → Number (with editable min/max bounds)
  → Date (YYYY-MM-DD, timezone-independent validation)
  → Text area
  → Checkbox (tri-state: blank / unchecked / checked)
  → Choice / Select (ordered options, add/edit/remove/reorder)

Field Configuration Editing (Inspector)
  → Label, Type, Value, Clear
  → Number: min/max inline editing
  → Choice: options add/edit/remove/reorder (compact ordered editor)
  → Date: native date input
  → Label: no value editor shown
  → Checkbox: accessible tri-state interaction

Safe Type/Config Change (no silent data loss)
  → set_field_type with explicit confirmClear flag
  → Compatible value → kept
  → No current value → change normally
  → Incompatible explicit value → rejected, requires explicit user approval to clear
  → Atomic clear+change in single mutation/version
  → Same protection for Number bounds and Choice options edits

Safe Field Delete
  → Destructive confirmation dialog
  → Preserves existing canonical remove_field behavior
  → Field registry, structure, values, layout cleanup
  → Minimum-field invariant enforced
  → Confirmed read-only behavior unchanged

Safe remove_section
  → New canonical mutation: remove_section
  → EMPTY section → allowed (destructive confirmation)
  → Non-empty section → rejected with clear explanation
  → No cascade delete, no auto-reparent, no silent deletion
  → Atomic cleanup: sections[], structure[], layout.sections[key], layout.nodes[key]

One-Level Server-Authoritative Undo
  → Dedicated POST /undo transport (not generic PATCH)
  → Server-authoritative: reads undoSourceVersion from D1 head
  → Loads undo source from R2, creates new version V+1
  → ExpectedVersion concurrency protection
  → Restores structure + layout + values + registries atomically
  → Consumes eligibility (undoConsumed = true)
  → Second Undo without intervening mutation → rejected
  → No Redo, no history browser, no arbitrary version restore
  → Undo metadata in D1 head (undoSourceVersion, undoConsumed)

Web UX
  → Undo button in WorkshopToolbar (enabled when server reports availability)
  → DestructiveConfirmDialog for Field/Section deletion
  → ChoiceOptionsEditor (add/edit/remove/reorder)
  → NumberBoundsEditor (min/max)
  → Date input (native)
  → Label field (static display, no value editor)
  → Checkbox tri-state (blank/unchecked/checked)
  → Confirm read-only state
```

## Contract Summary

- **Canvas/Inspector/Preview authority unchanged** — 14.9 spatial architecture frozen
- **DraftMutationV2 unchanged for undo** — `undo` is NOT in generic mutation union
- **Undo is dedicated POST /undo** — not generic PATCH DraftMutationV2
- **Undo consumption atomic with head advance** — `persistUndoDraftV2` sets `undoConsumed=true` in same D1 CAS
- **Version arithmetic exact** — current V → Undo creates V+1 (not V+2)
- **Restored content boundary** — fields/sections/structure/layout/values from undo source; identity/provenance from current draft; characterName mirrors restored values
- **Date validation timezone-independent** — UTC-based validation, no `new Date(value + "T00:00:00")`
- **Label semantics** — no value, set_value rejected with truthful message
- **Checkbox tri-state** — blank → checked → unchecked → blank cycle
- **Historical snapshots readable** — no breaking schema changes
- **E2E B waitForTimeout** — accepted debt, untouched

## Boundaries (unchanged by 14.10)

- HTTP namespace stays `/v1/character-sheets`; no undo-specific route in generic mutation
- R2 key layout unchanged; D1 head semantics extended only for Undo metadata
- `expectedVersion` concurrency and confirmed immutability unchanged
- Turnstile, R2 tenant isolation, extraction/enrichment unchanged
- Spatial layout bounds: Root/Section 1..4 columns; node rowSpan 1..12
- Canvas/Inspector/Preview spatial architecture frozen

## Explicitly deferred to 14.11+

- Final generation contract (CharacterSheetSpec projection)
- AI presentation / visual styles
- Portrait integration
- Final ornamented PDF
- Advanced AI authoring
- Campaigns, persistent libraries, saved Tables
- Monetization / premium entitlements

## Related documents

- ADR-060 — Server-Authoritative Character Sheet Undo Architecture
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- `docs/architecture/phase-14.9/character-sheet-visual-canvas.md` (14.9 foundation)
- ADR-059 — Visual Canvas Direct Manipulation Architecture
- Phase 14.8 spatial authoring foundation

## Test Coverage

**Domain (character-sheet-draft):**
- All 7 MVP field types: definition, value validation, blank semantics
- Type/config change: compatible keep, incompatible reject, explicit clear
- Number bounds / Choice options / Date / Label / Checkbox tri-state
- remove_section: empty success, non-empty rejection, layout cleanup
- Undo: restore V → V+1, version conflict, one new version, structure/layout/values restored, Field/Section delete Undo, move/reparent Undo, resize/grid Undo, confirmed rejection, consumed eligibility, no Redo, no-op doesn't replace source

**Web unit/RTL:**
- All MVP types editable in Inspector
- Date input, Label no value editor, tri-state Checkbox, Choice blank clears
- Number/Choice config editing, destructive confirmations, non-empty Section explanation
- Undo applies authoritative response, confirmed UI read-only

**E2E:**
- E2E D — Authoring completeness (all MVP types, config, confirm)
- E2E E — Safe deletion + Undo (empty Section, non-empty protection, Field delete, Undo destructive, Undo spatial)

**Worker integration:**
- Real Undo integration test: create → mutate → Undo → V+1 → restored content → consumed → second Undo rejected