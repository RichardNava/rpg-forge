# Phase 14.7 Character-Sheet Integration — Generation Boundaries and Sheet Sessions

**Status:** Implemented (A1 + A2)
**Date:** 2026-09-13

## Purpose

Phase 14.7 wires the deterministic character-sheet construction (Phase 14.5)
and PDF renderer (Phase 14.6) into the temporary standalone generation model:
a genuine GUI-only path that needs no RulesContext, persistent session/run
bookkeeping in D1, and a clean boundary for the still-deferred artifact
storage (R2) and HTTP orchestration slices.

This document describes the **actual committed architecture** after 14.7A1 and
14.7A2. Planned slices are labeled explicitly as deferred and are never
described as implemented.

Slice summary:

- **14.7A1** — `CharacterSheetSpec.rulesContextId` is required but nullable;
  null means "no RulesContext authority"; genuine GUI-only final construction;
  explicit `sheetId` for GUI-only; null-context provenance fails closed;
  GUI-only PDF integration green.
- **14.7A2** — `@repo/character-sheet-session`; 120-minute temporary sheet
  sessions; SHA-256 token-hash ownership; final synchronous run lifecycle;
  `sheet_sessions` and `sheet_generation_runs` D1 tables; nullable rulebook
  identity triple; one current run per session; repost-supersede semantics;
  additive migration 0003; real D1/workerd repository tests.

By design, Phase 14.7A adds **no** R2 adapter, **no** HTTP routes, **no**
production AI providers, **no** Workflow, and **no** UI.

## Boundaries

Implemented through 14.7A:

- domain contracts
- GUI-only final construction
- rulebook-capable final construction
- deterministic PDF renderer
- sheet session/run persistence (D1 operational metadata only)

Deferred:

- R2 artifact persistence — 14.7B
- production provider adapters — 14.7C
- HTTP orchestration — 14.7D
- web UI / preview / E2E — later 14.7 slices

## Authoritative production pipeline

The target integration pipeline is:

```text
Web authoring UI
  ↓
temporary sheet session
  ↓
optional rulebook analysis/context
  ↓
GUI + optional RulebookDerivedDefinition
  ↓
structured Level-1 operations
  ↓
NormalizedSheetDefinition
  ↓
CharacterSheetSpec
  ↓
deterministic PDF renderer
  ↓
temporary R2 artifacts
  ↓
preview/download
```

Implemented today: domain contracts, GUI-only and rulebook-capable final
construction, the deterministic PDF renderer, and sheet session/run
persistence. The web authoring UI, the R2 artifact step, HTTP orchestration,
and preview/download are deferred.

## GUI-only is first-class

A GUI-only sheet is a genuine, standalone output with no rulebook authority:

- context = `null`
- `rulesContextId` = `null` (see Contracts below)
- `sourceMap` contains no rulebook provenance
- explicit server-owned `sheetId`
- `analysis_id` = `NULL`
- `rules_analysis_run_id` = `NULL`
- `ingestion_id` = `NULL`

There are no synthetic rulebook identifiers and no fake `RulesContext`.
GUI-only persistence does not require rule-analysis rows: the run is created
under a sheet session with all three rulebook identity columns null, and the
persistence layer stores operational metadata only. GUI-only generation never
calls `RulebookFieldDerivationPort` (asserted in the regression and PDF
integration suites).

## Rulebook-backed semantics

For rulebook-backed construction:

- `rulesContextId` = real `context.analysisId`.
- Existing evidence/citation/provenance validation remains authoritative
  (`PROVENANCE_CONTEXT_REQUIRED`, `UNKNOWN_SOURCE_MAP_RULE`,
  `SOURCE_MAP_CITATION_NOT_LINKED_TO_RULE`, `RULES_CONTEXT_ID_MISMATCH`).
- GUI and rulebook remain **equal/additive Level-2 sources**, merged on
  `(category, canonicalKey)`; incompatible mechanical definitions surface as
  visible conflicts instead of silent winners.
- Exact canonical-key duplicate merge remains the rule. Semantic replacement
  is not resurrected.
- A null context plus rulebook provenance fails closed
  (`SOURCE_MAP_WITH_NULL_RULES_CONTEXT` plus compile-time rejection). The
  compiler never builds a source map from field rule ids without a context.

## Character name boundary

- The supplied character name stays exact; a blank name uses the narrow
  `Level3NamePort` fallback with bounded retries and a visible failure.
- No production `Level3NamePort` adapter exists; only fakes are used in
  automated tests. The provider implementation belongs to 14.7C.
- The name provider grants **no** gameplay or mechanical authority: it can
  supply only a bounded display string for the visible `character_name` field.

## Free-text instructions boundary

- `contextInstructions` production extraction remains **deferred**.
- Phase 14.7 does not restore the failed free-text extraction path. Raw
  request text never enters the deterministic engine.
- Structured Level-1 operations remain authoritative.
- Do not interpret free-text instructions as parsed in production today.

## Temporary sheet session model

Sheet session identity is **separate** from rules-analysis session identity.

- Lifetime: exactly `SHEET_SESSION_LIFETIME_MS` = 120 minutes (it does not
  reuse the 12-hour rulebook-analysis lifetime).
- Ownership: an opaque access token is issued once; only its SHA-256 hash is
  persisted in D1 (`token_hash`); authorization verifies the presented token
  against the hash.
- Plaintext token: returned exactly once, never persisted.
- Lifecycle statuses: `ACTIVE` → `DELETING` (cleanup markers follow the
  rules-analysis retry-grace cadence).
- No Better Auth dependency: standalone temporary sheets are anonymous and do
  not require an account.

## Final run lifecycle

```text
create → PENDING → READY
create → PENDING → FAILED
```

Processing terminality:

- `READY` and `FAILED` are terminal **for processing transitions**: `markReady`
  and `markFailed` only accept `PENDING`, and no later processing transition
  overwrites a terminal state; the run stays the current one.

Repost semantics:

- a user-requested new generation **may supersede the current run, including a
  `READY` or `FAILED` current run**:

```text
old current → INVALIDATED → is_current = false
new run     → PENDING     → is_current = true
```

`READY`/`FAILED` are **not** described as absolutely immutable states; the
repost-supersede path intentionally reaches them. Explicit
`invalidateCurrent` is narrower (PENDING/READY only), while
`createCurrent`'s supersede is status-agnostic by design.

## Expiry semantics

- Run expiry `expiresAt` = owning session `expiresAt` (`deriveRunExpiry`).
- It is **not** `run.createdAt + 120 minutes`.
- A run created late in a session inherits only the remaining session lifetime
  (a run created at T−5min expires at T).
- Cleanup distinction: `EXPIRED` is a lifecycle state, but final artifact
  cleanup in 14.7B must not assume only `EXPIRED` runs can own artifacts.

## D1 model

D1 holds **operational metadata only** — no `CharacterSheetSpec` JSON, no PDF
bytes, no provider payloads.

`sheet_sessions`:

- `session_id`
- `token_hash`
- `status`
- `created_at`
- `updated_at`
- `expires_at`

`sheet_generation_runs`:

- `run_id`
- `session_id`
- `analysis_id` (nullable)
- `rules_analysis_run_id` (nullable)
- `ingestion_id` (nullable)
- `mode`
- `status`
- `failure_code`
- `is_current`
- `created_at`
- `updated_at`
- `expires_at`

Migration 0003 is additive: it creates both tables and their indexes and
modifies nothing else (0000–0002 byte-unchanged, journal ordered).

## Current-run invariant

At most one current run per sheet session:

- enforced by the partial unique index on `session_id WHERE is_current = 1`
  as the database backstop, and
- by repository supersede semantics in `createCurrent`.

Generation currency is scoped by **sheet session**, not by analysis id.

## Atomicity

`createCurrent` semantics:

- prior-current invalidation (`status = INVALIDATED`, `is_current = false`)
  and new-current insertion happen in **one D1 batch**.
- The D1 batch is treated as the all-or-nothing persistence primitive used
  here.
- The partial unique index is the final database backstop; a concurrent unique
  collision rolls back the whole batch and is represented as a deterministic,
  retryable `conflict` outcome.
- No stronger serializability guarantee is claimed than this batch + backstop
  behavior actually provides.

## Database-integrity boundary

- No D1 foreign keys were introduced, following the current rules-worker
  convention (rules-analysis tables are likewise FK-free).
- Consequently, application/repository orchestration is responsible for
  validating ownership and session relationships before persistence
  operations.
- This is flagged as an HTTP/orchestration concern for 14.7D; no FKs are added
  in 14.7A.

## No-Workflow decision

- No character-sheet Cloudflare Workflow exists.
- The current final generation architecture is intended to execute
  synchronously after prerequisites are ready.
- Async orchestration (Workflow or similar) is revisited only if real
  production latency/runtime evidence requires it.

## Artifact storage boundary

R2 is 14.7B. The expected conceptual ownership tree is:

```text
sheet session
  └─ run
      ├─ spec.json
      └─ sheet.pdf
```

- Exact object-key syntax is not frozen here; 14.7B owns it.
- 14.7B owns: the project artifact port, the R2 adapter, controlled object
  keys, content types, cleanup, and artifact replacement/deletion.

Across 14.7A, D1 contains no R2 keys and no artifact references; the run/session
repositories are the sole persistence surface.

## 14.7B cleanup requirement (acceptance condition)

R2 artifact cleanup must cover **all** artifacts owned by a sheet session/run,
including artifacts belonging to runs that are `READY`, `FAILED`,
`INVALIDATED`, or `EXPIRED`.

- A session deletion/expiry must not leave orphaned `spec.json`, PDF, or
  future artifact objects behind.
- 14.7B must not design cleanup solely around
  `findCleanupCandidates(status = EXPIRED)` if doing so could leave superseded
  or failed artifacts behind.
- 14.7B must define a **total session/run artifact cleanup strategy**.

(This is a documentation-only statement today; it is not implemented.)

## Runtime and testing

Committed A1+A2 suites (all green on the committed tree):

- `@repo/character-sheet-schema`: 26 tests / 1 file.
- `@repo/character-sheet-generation`: 372 tests / 18 files (includes the
  GUI-only regression suite).
- `@repo/character-sheet-pdf-renderer`: 34 tests / 2 files (renderer + the
  GUI-only PDF integration test).
- `@repo/character-sheet-session`: 22 tests / 1 file (port contract suites).
- `rules-worker` node suite: 88 tests / 6 files.
- `rules-worker` workerd suite: 104 tests / 14 files (includes the real-D1
  sheet-session 8-test and sheet-run 15-test repository suites).

## Deferred work

- **14.7B** — temporary artifact port, R2 adapter, controlled object keys,
  content types, retrieval, and total cleanup (see entry conditions below).
- **14.7C** — production provider adapters (text and image), including the
  `Level3NamePort` and `RulebookFieldDerivationPort` production
  implementations. Not present today.
- **14.7D** — HTTP orchestration: session creation/authorization, run
  management, ownership validation, preview/download. Not present today.
- **Later 14.7 slices** — web UI, preview, E2E.

## Exact 14.7B entry conditions

Available now from committed code:

- stable sheet `sessionId`
- stable `runId`
- one-current-run invariant (partial unique index + supersede semantics)
- explicit run/session expiry (`expiresAt` inherited from session)
- GUI-only independent of rulebook identities (nullable triple)
- cleanup candidate primitives (session + run)
- deterministic `CharacterSheetSpec`
- deterministic PDF renderer

14.7B's exact responsibility:

```text
CharacterSheetSpec / PDF
  → temporary artifact port
  → R2 implementation
  → controlled ownership/keying
  → retrieval
  → total cleanup (including failed and superseded run artifacts)
```

## Related documents

- ADR-056 — Deterministic character-sheet final construction
- ADR-015 / ADR-052 — PDF export stack and workerd AcroForm renderer
- ADR-054 — Zod 4 as canonical runtime validation
- Phase 14.6 — Character-Sheet PDF Renderer
- Phase 14.5 — Character-Sheet Generation
- `docs/architecture/data-model.md` — persistence direction (read for scope
  of D1/R2 responsibilities)
