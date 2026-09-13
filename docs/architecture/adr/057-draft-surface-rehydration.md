# ADR-057 — Editable character-sheet drafts (surface model + rehydration snapshots)

**Status:** Accepted
**Date:** 14/09/2026

## Context

A product invariant (see `AGENTS.md` §1) requires that **generated content
must remain editable before export**. The deterministic character-sheet
pipeline (Phase 14.5/14.6/14.7) currently produces a final
`CharacterSheetSpec` snapshot and a PDF; there is no intermediate authoring
surface, so an edit resets to the oracle and regenerates. Editing the final
spec directly was rejected because the spec is the export contract: its
placement, grouping, and bounds are construction-owned, not user-editable.

The MVP persistence boundary (ADR-016) gives temp sheet state an ephemeral
home: R2 for temporary artifact storage (ADR-007 concretized in 14.7B as
`SHEET_ARTIFACTS`, spec + PDF per run) and D1 for operational run/session
metadata only. The next slice after 14.7C is the **editable dimension**: a
surface model that keeps output editable before export, persisted as
temporary versioned snapshots, with rehydration interfaces following in a
dedicated slice.

Three pressures shaped the decision:

1. **Edits need a bounded, purpose-built domain**, not the full spec. The
   draft must constrain edits (few hundred fields max, safe keys, typed
   values) and communicate what was auto-generated (read-locked fields) so a
   reroll redraws what a model owned without touching what the user changed.
2. **The authoring surface is shared by two deployables.** The future web UI
   (glance-edit) owns UX; the rules-worker owns R2 rehydration writes. The
   domain must live once, in a technology-neutral workspace package, so no
   deployable reimplements it and neither imports the other's internals.
3. **Temp state must stay temp.** Drafts are not user resources: no D1 rows,
   no bundles, no event log, no R2 binding beyond the existing sheet bucket.
   Session cleanup (already total-prefix by construction in 14.7B) must cover
   drafts by design rather than by a second cleanup path.

## Decision

- **Create `@repo/character-sheet-draft` now.** A pure domain package (no
  React, Next.js, Cloudflare, Drizzle, or AI) containing the surface model,
  guided-edit edits map, order-preserving mutation API, deterministic reroll,
  preview/writeback projection, versioning, R2 keys, and the
  `CharacterSheetDraftStore` port. The rules-worker R2 adapter depends on it;
  the future web rehydration slice depends on the same package. This follows
  the ADR-022 "real reuse" rule: the domain is the single shared contract for
  both deployables.
- **Drafts are bounded surface models.** At most 192 fields and 192 values;
  every key rides the safe field-key alphabet (`A-Za-z0-9._:-`), so a draft
  key is simultaneously a valid `CharacterSheetSpec` field id and a
  path-safe R2 segment. Field kinds: `text`, `number`, `textarea`, `checkbox`,
  `choice`. Drafts carry no game-system knowledge.
- **`characterName` mirrors `values["character_name"]`.** It is a derived
  display convenience (`null` when unset); a mismatch fails validation
  (`invalid_draft`). There is exactly one name source of truth.
- **Read locks express reroll ownership.** A locked field carries a draw
  grammar — a `choice` lock declares `options`; a `number` lock declares
  `min`/`max` — and rerolling a locked field is a deterministic seeded draw
  from the shared PRNG (no `Math.random`, same `(mode, seed)` reproduces the
  same values, drawn values stay in bounds, explicit values always win).
  Unlocked fields are freely editable. This keeps model-owned output
  regenerable without letting reroll overwrite user edits.
- **Edits are ordered single ops.** `applyDraftMutation` applies one op at a
  time (`set_value`, `unset_value`, `add_field`, `remove_field`,
  `rename_field`, `set_label`, `toggle_read_lock`, `unlock_field`) with a
  typed taxonomy (`invalid_mutation`, `field_read_locked`,
  `draft_session_mismatch`, `session_expired`, `surface_out_of_bounds`,
  `draft_inflight`). No CRDT, no concurrent merge.
- **Snapshots are immutable and versioned.** Identity is
  `(sessionId, draftId)`; `version` starts at 1; every persisted snapshot is a
  full `v<version>.json`. Concurrent-writer detection is a belated version
  assertion (`assertDraftVersion`), not history merging.
- **Drafts share the sheet-session R2 tenant.** Keys live under
  `temp/character-sheets/v1/sessions/<sessionId>/drafts/<draftId>/`, a sibling
  of `runs/`. The 14.7B total `deleteSessionArtifacts(sessionId)` prefix sweep
  therefore wipes session drafts by construction, pinned by a regression
  suite; `deleteDraft` allows single-draft cleanup. No D1 rows, no migrations,
  no new binding: the existing local-only `SHEET_ARTIFACTS` bucket holds
  drafts.
- **One port, one adapter.** `CharacterSheetDraftStore` exposes only
  `putDraft`, `getDraftVersion`, `listDraftVersions`, `getLatestDraft`,
  `deleteDraft`. All failures surface through the `DraftError` taxonomy
  (`invalid_draft | invalid_draft_identity | corrupt_draft |
storage_unavailable | cleanup_failed` plus the domain codes). The
  rules-worker adapter depends on a narrow `R2BucketLike` shape (put/get/
  list/delete) so it is unit-testable with a fake bucket while remaining
  structurally compatible with `R2Bucket`.
- **Defer the web rehydration slice.** The glance-edit UI, the web store
  interfaces that drive drafts from the app, and intermediate widgets come in
  a dedicated later slice; their foundation (this package + the R2 adapter) is
  committed first so the domain is reviewable in isolation.

## Consequences

- Generated sheets have an edit path that is bounded, typed, and persisted as
  versioned temp snapshots; rewriting a version is impossible by construction,
  and a stale edit cannot silently clobber a newer snapshot.
- The domain is shared between deployables with no dependency on either; the
  web slice imports `@repo/character-sheet-draft` without touching
  rules-worker, and the R2 adapter stays infrastructure in rules-worker.
- Session/expiry cleanup needs no draft-specific code path: the total-prefix
  sweep already covers drafts, and `deleteDraft` is an optional finer-grained
  cleanup for abandoned single drafts.
- Rerolling reads a lock grammar to redraw model-owned fields without
  overwriting user edits; the seed/`(mode, seed)` pair keeps reroll
  reproducible and test-friendly (fake-provider-free, no inference quota).
- Writing a draft validates it (schema + identity + mirror) before PUT and
  re-validates on read; corruption surfaces as `corrupt_draft`, missing reads
  as `null`, and storage/cleanup failures stay distinguishable for the future
  orchestrator.
- Accepted residue: the draft is a surface model, not the full spec; the
  `CharacterSheetSpec` remains the export authority, and any
  draft→spec reconciliation happens through `writebackDraftToSpec` in the
  later rehydration slice.

## Implementation status (Phase 14.7E)

- `@repo/character-sheet-draft` is committed (73 tests / 9 files) and shipped
  with the R2 adapter `createR2CharacterSheetDraftStore` (13 fake-bucket tests
  - 3 workerd tests, including the cross-adapter regression that
    `deleteSessionArtifacts` wipes drafts).
- The web store interfaces and glance-edit UI remain deferred to the dedicated
  rehydration slice; nothing here creates HTTP routes, UI, D1 tables, or
  remote Cloudflare resources.

## Related ADRs

- ADR-007 — R2 deferred as ephemeral/temporary object storage
- ADR-016 — MVP persistence boundary (temp state ≠ user resources)
- ADR-022 — Internal packages only with real reuse
- ADR-054 — Zod 4 as canonical runtime validation
- ADR-056 — Deterministic character-sheet final construction
