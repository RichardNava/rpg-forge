# ADR-060 — Server-Authoritative Character Sheet Undo Architecture

**Status:** Accepted
**Date:** 12/10/2026

## Context

Phase 14.10 adds one-level server-authoritative Undo to the Character Sheet Generator. The Canvas (14.9) already provides complete before/after/inside DnD, direct grid resize, and keyboard-accessible moves. The missing piece for MVP authoring completeness is the ability to undo the last authoring action.

Key constraints from 14.9 architecture:
- Draft state is server-authoritative; client holds optimistic preview only
- `expectedVersion` concurrency control on all mutations
- D1 `sheet_draft_heads` coordinates version advancement via CAS
- R2 stores immutable canonical snapshots per version
- No client-side Draft snapshot may be the Undo authority

## Decision

### 1. Undo is a dedicated transport operation

Undo is NOT a generic `DraftMutationV2` (`op: "undo"`). It travels via a dedicated POST endpoint:

```
POST /v1/character-sheets/sessions/:sessionId/drafts/:draftId/undo
Body: { expectedVersion: number }
Response: raw CharacterSheetDraftV2 (same shape as mutation/confirm)
```

Reason: Undo requires server-side history (the `undoSourceVersion` from D1 head) and cannot be correctly performed from a single Draft snapshot alone. The client sends only `expectedVersion`; the server resolves the undo source and creates a new snapshot.

### 2. D1 head metadata for one-level Undo eligibility

`sheet_draft_heads` gains two columns:

- `undo_source_version INTEGER` — the authoritative version eligible for Undo (the version immediately before the last real authoring mutation)
- `undo_consumed INTEGER (boolean) NOT NULL DEFAULT false` — whether the one-level Undo has been consumed

These live in the existing `sheet_draft_heads` table (no new table).

### 3. Undo eligibility lifecycle

**Normal authoring mutation (V → V+1):**
- D1 commit sets `undoSourceVersion = V`, `undoConsumed = false`
- The previous version V becomes the Undo source

**Successful Undo (current V+1 → V+2):**
- Reads `undoSourceVersion = U` from head (where U = V)
- Loads snapshot U from R2
- Creates new draft with content from U, version = current V+1
- Applies undo mutation → bumps to V+2
- Commits with `undoConsumed = true`, `undoSourceVersion` unchanged (remains U)
- Atomically advances head V+1 → V+2 in same D1 CAS

**After Undo:**
- `currentVersion = V+2`
- `undoSourceVersion = V` (unchanged)
- `undoConsumed = true`

**Second Undo without intervening mutation → rejected** (`undo_already_consumed`)

**Next real authoring mutation (V+2 → V+3):**
- Sets `undoSourceVersion = V+2`, `undoConsumed = false`
- Creates new Undo eligibility for the just-committed state

**Semantic no-op:** Does not replace Undo source or reset consumed flag.

### 4. Undo restores content from U, identity from current

The restored draft copies **content** from the undo source U:
- `fields`, `sections`, `structure`, `layout`, `values` from snapshot U

But preserves **identity/provenance** from current draft:
- `draftId`, `sessionId`, `baseVersion`, `mode`, `rulesContextId`, `source`
- `characterName` derived from restored `values["character_name"]`
- `confirmed: false` (Undo result is never confirmed)

This ensures `characterName` mirrors restored `values["character_name"]` and the draft remains mutable.

### 5. Atomic Undo consumption

Undo head advancement and Undo-consumption metadata are part of the **same D1 CAS transition** in `commitUndo`. There is no intermediate state where:

```
currentVersion = V+1
undoConsumed = false
undoSourceVersion = V  // the just-undone version
```

Such a state would allow an immediate second Undo to act as Redo. The `commitUndo` function sets `undoConsumed = true` in the same D1 CAS that advances `currentVersion`.

### 6. Undo is NOT a generic DraftMutationV2

`DraftMutationV2Schema` does NOT include `op: "undo"`. The generic `PATCH /drafts/:id` endpoint rejects `{ mutation: { op: "undo" } }`. Undo travels only through the dedicated `POST /undo` endpoint and `undoDraftV2` orchestration.

### 7. Exact version arithmetic

Current authoritative version = V.
Successful Undo produces exactly **V+1** (not V+2).

The Undo source snapshot at version U is loaded, its content copied into a draft at version V, the undo mutation bumps to V+1, and `persistUndoDraftV2` advances head V → V+1. No pre-bump plus mutation bump. No V+2 jump from one operation.

### 8. Error codes

- `undo_not_available` — `undoSourceVersion` is null
- `undo_already_consumed` — `undoConsumed` is true
- `undo_source_missing` — R2 snapshot for `undoSourceVersion` not found
- Standard: `version_conflict`, `draft_confirmed`, `storage_unavailable`

## Alternatives considered

- **Client-side Undo stack** — rejected: violates server-authoritative architecture; client state can be stale/lost
- **Undo as generic mutation** — rejected: requires server-side history not present in single Draft snapshot
- **Undo as Redo-capable history** — rejected: scope is one-level only for MVP; no Redo, no history browser
- **Separate Undo history table** — rejected: reuses existing R2 snapshots + minimal D1 head metadata; no second history store

## Consequences

- One-level Undo only; no Redo; no history browser
- Undo eligibility metadata stays in D1 head (no new table)
- Real R2 snapshots reused — no duplicate history store
- Dedicated transport keeps generic mutation surface clean
- Atomic consumption prevents Redo race window
- Exact V+1 version arithmetic preserved
- Date/Label/Checkbox semantics clarified as part of 14.10 Field completeness

## Non-goals

- No Redo
- No history browser
- No arbitrary version restore UI
- No client-side Undo authority
- No second history store