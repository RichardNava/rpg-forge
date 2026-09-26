# Phase 14.7 Character-Sheet Integration — Generation Boundaries and Sheet Sessions

**Status:** ACTIVE (14.7A–14.7G delivered; recursive DnD, remove_section, Undo,
image/style integration in progress). The phase-14.7 slices are proven by
committed automated suites; 14.7G adds the first product-facing authoring UI
driven by an in-memory local backend, with the server-wired (Turnstile +
rules-worker) path remaining a configuration switch.
**Date:** 2026-09-26

**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Phase status labels:** CURRENT / COMPLETED / SUPERSEDED / DEFERRED

## Purpose

Phase 14.7 wires the deterministic character-sheet construction (Phase 14.5)
and PDF renderer (Phase 14.6) into the temporary standalone generation model:
a genuine GUI-only path that needs no RulesContext, persistent session/run
bookkeeping in D1, clean temporary artifact storage in R2, and a clean
boundary for the still-deferred HTTP orchestration slice. 14.7C adds the
template-backed path: a blank sheet template can be extracted from a source
sheet and used as the authority for which fields a generated sheet contains.
14.7E adds the **editable authoring surface**: generated output stays editable
before export through versioned, temporary draft snapshots (domain in
`@repo/character-sheet-draft`, R2 adapter in rules-worker). 14.7G adds the
**Character Workshop UI**: the web rehydration store interfaces that drive
drafts from the UI, a React store binding, schema-driven field editors, a live
preview, and the confirm-to-read-only flow — backed in development by an
in-memory local backend that runs the real draft-domain rules.

This document describes the **actual committed architecture** after 14.7A,
14.7B, 14.7C, 14.7E and 14.7G. Planned slices are labeled explicitly as
deferred and are never described as implemented.

**For current product behavior, see `docs/features/character-sheets.md` (ACTIVE).**

Slice summary (labeled by status):

- **14.7A1 [COMPLETED]** — `CharacterSheetSpec.rulesContextId` is required but nullable;
  null means "no RulesContext authority"; genuine GUI-only final construction;
  explicit `sheetId` for GUI-only; null-context provenance fails closed;
  GUI-only PDF integration green.
- **14.7A2 [COMPLETED]** — `@repo/character-sheet-session`; 120-minute temporary sheet
  sessions; SHA-256 token-hash ownership; final synchronous run lifecycle;
  `sheet_sessions` and `sheet_generation_runs` D1 tables; nullable rulebook
  identity triple; one current run per session; repost-supersede semantics;
  additive migration 0003; real D1/workerd repository tests.
- **14.7B [COMPLETED]** — `@repo/character-sheet-artifacts`; the `CharacterSheetArtifactStore`
  port; R2 adapter in rules-worker; controlled object keys; content types and
  `Cache-Control: no-store` metadata; write compensation; retrieval; and total
  session/run prefix cleanup. Local-only `SHEET_ARTIFACTS` binding; production
  bucket identity deferred.
- **14.7C [COMPLETED]** — template-backed generation: `@repo/character-sheet-template`
  (template contracts, extraction port, reference extractor); generation-side
  template normalization and template/GUI overlay; the provider-free
  `DeterministicLocalNamePort` default for the standalone character name; and
  `generateTemplateBackedSheet` wiring. The production multimodal extraction
  provider is **blocked** (no vision model is committed) and remains the only
  deferred 14.7C item. **[SUPERSEDED / HISTORICAL 14.7C LIMITATION: this describes the template-backed generation flow (14.7C) only; the current uploaded-sheet visual extraction pipeline via Workers AI vision adapter is IMPLEMENTED — see Temporary Uploaded Sheet Extraction section below]**
- **14.7E [COMPLETED]** — editable authoring surface: `@repo/character-sheet-draft`
  (bounded surface model, guided-edit edits map, order-preserving mutation API,
  deterministic reroll of read-locked fields, versioned immutable snapshots,
  R2 keys under the sheet-session tenant, the `CharacterSheetDraftStore` port)
  plus the `createR2CharacterSheetDraftStore` adapter in rules-worker. Web
  rehydration store interfaces and the glance-edit UI are delivered in 14.7G.
- **14.7G [COMPLETED]** — Character Workshop UI: the web rehydration surface
  (`SheetApiClientPort` transient session client, `SheetStore` lifecycle with
  domain-level mutation outcomes, `useSheetStore` React binding), a
  forge/cartography-themed workshop UI (creation-mode landing, toolbar,
  sidebar field roster, schema-driven field editors, live preview via
  `projectDraftToSpec`, confirm → read-only exported state), and the
  rules-worker proxy confirm whitelist. In development the store is driven by
  an in-memory local backend (`createLocalSheetBackend`) that implements the
  real draft-domain rules; `NEXT_PUBLIC_CHARACTER_SHEET_BACKEND=remote` opts
  into the `SheetApiClient` path (Turnstile verification remains to be wired,
  so remote is not the default). **[SUPERSEDED: current official code defaults to remote (production), local only for NODE_ENV=test]**

**Current active work (not in original 14.7 slices):**

- Recursive DnD with before/after/inside targets [TARGET — not implemented]
- `remove_section` mutation with safe semantics [TARGET — not implemented]
- Server-authoritative Undo with `expectedVersion` conflict protection [TARGET — not implemented]
- Character image (upload/URL/AI generation) [TARGET — not implemented]
- Visual style rendering integration [TARGET — not implemented]

## Boundaries

Implemented through 14.7G:

- domain contracts
- GUI-only final construction
- rulebook-capable final construction
- template-backed construction (template normalization + template/GUI overlay)
- deterministic PDF renderer
- sheet session/run persistence (D1 operational metadata only)
- temporary R2 artifact storage (spec + PDF per run, total prefix cleanup)
- editable authoring surface (draft domain + R2 draft store adapter; versioned
  snapshots under the sheet-session tenant)
- Character Workshop UI (web rehydration store + React binding + schema-driven
  editors, preview, confirm flow) driven by an in-memory local backend

Deferred [DEFERRED]:

- server-wired Workshop path — Turnstile verification widget and the production
  `SheetApiClient` route (`NEXT_PUBLIC_CHARACTER_SHEET_BACKEND=remote` is
  implemented client-side but verifies against rules-worker only after the
  Turnstile secret is configured); **the local backend was the default [SUPERSEDED: current official code defaults to remote (production), local only for NODE_ENV=test]**
- template extraction from external rulebook sources (the standalone uploaded
  character-sheet path is implemented separately below)
- production `RulebookFieldDerivationPort` adapter — superseded for the
  template-backed flow; kept as a legacy port
- HTTP orchestration — 14.7D
- **PDF export/download [IMPLEMENTED]** and **PC/NPC mode selection [IMPLEMENTED]** in the workshop UI — future 14.7 slices

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

Editable path (14.7E surface, web rehydration deferred):

```text
CharacterSheetSpec / PDF   (final run)
  ↓
draft snapshot             (@repo/character-sheet-draft domain)
  ↓
guided edits / reroll      (order-preserving mutation API + read-locked reroll)
  ↓
versioned draft snapshots  (R2, sheet-session tenant, immutable v<version>.json)
  ↓
future web rehydration     (store interfaces + glance-edit UI, deferred)
```

**Implemented [COMPLETED]:** domain contracts, GUI-only and rulebook-capable final
construction, the deterministic PDF renderer, sheet session/run persistence,
temporary R2 artifact storage, the editable draft domain + R2 draft store
adapter, and the Character Workshop UI (web rehydration store + React binding +
schema-driven editors) driven by an in-memory local backend. The server-wired
Turnstile path, HTTP orchestration, and **PDF export/download [IMPLEMENTED]** remain deferred.

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
- In the standalone template-backed flow, the default fallback is the
  provider-free `DeterministicLocalNamePort`: a seeded, locale-aware,
  syllable-based local name source (`createDeterministicLevel3NamePort`
  adapts it to the Level-3 contract). The same `(mode, seed, locale)` triple
  yields the exact same name, and the public standalone generator never needs
  a model or inference quota for a usable character name.
- No production AI `Level3NamePort` adapter exists; automated tests use fakes
  (and the deterministic adapter) exclusively.
- The name source grants **no** gameplay or mechanical authority: it can
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

R2 is implemented in 14.7B. The actual ownership tree is:

```text
sheet session
  └─ run
      ├─ spec.json
      └─ sheet.pdf
```

Concrete object keys (frozen in 14.7B):

```text
temp/character-sheets/v1/sessions/<sessionId>/runs/<runId>/spec.json
temp/character-sheets/v1/sessions/<sessionId>/runs/<runId>/sheet.pdf
```

- `<sessionId>` and `<runId>` pass through `artifactPathSegment`: non-empty,
  at most 128 characters, must not contain `/`, `\`, or `..`, then
  percent-encoded. Every key embeds both opaque identities, so a stale run can
  never address another session's or run's objects.
- Both the session prefix and the run prefix end with a trailing separator
  (`.../sessions/<sessionId>/`, `.../runs/<runId>/`), so prefix matching is
  isolated by construction even for similar ids (e.g. `session-a` never matches
  `session-a2`).
- The spec is serialized through `CharacterSheetSpecSchema` on write
  (`invalid_spec` on rejection) and re-validated on read (`corrupt_spec` on
  storage corruption or a contract change). Missing reads return `null`.
- Content types: `application/json; charset=utf-8` for `spec.json`,
  `application/pdf` for `sheet.pdf`. All objects are stored with
  `Cache-Control: no-store`.

### Port and error taxonomy

`@repo/character-sheet-artifacts` defines the `CharacterSheetArtifactStore`
port with exactly five identity-keyed methods and deliberately **no**
arbitrary-key read/write API:

- `putRunArtifacts({ sessionId, runId, spec, pdfBytes })`
- `getSpec({ sessionId, runId })`
- `getPdfBytes({ sessionId, runId })`
- `deleteRunArtifacts({ sessionId, runId })`
- `deleteSessionArtifacts(sessionId)`

Transport-neutral error codes:

```text
invalid_artifact_identity | invalid_spec | storage_unavailable | corrupt_spec | cleanup_failed
```

The adapter (`createR2CharacterSheetArtifactStore` in rules-worker) depends on
a narrow `R2BucketLike` shape (put/get/list/delete) so it is unit-testable with
a fake bucket while remaining structurally compatible with the real `R2Bucket`.

### R2 binding

- `SHEET_ARTIFACTS` is a **LOCAL-ONLY** binding to bucket
  `rpg-forge-sheets-local` in the `local` env.
- The root environment has **no** R2 binding: artifact storage fails closed
  until an approved remote bucket is explicitly configured (same policy as
  `RULEBOOK_BUCKET`).
- The local binding deliberately is **not** `RULEBOOK_BUCKET`: rulebook and
  sheet artifacts are distinct tenants with separate lifecycle and cleanup.

Across 14.7B, D1 contains no R2 keys and no artifact references; the run/session
repositories are the sole persistence surface.

## 14.7B cleanup requirement (acceptance condition)

R2 artifact cleanup covers **all** artifacts owned by a sheet session/run,
including artifacts belonging to runs that are `READY`, `FAILED`,
`INVALIDATED`, or `EXPIRED`, and including any unknown/future artifact kinds
that appear under the owning prefix:

- `deleteRunArtifacts` performs a **total run-prefix sweep**: it lists the
  exact `temp/character-sheets/v1/sessions/<sessionId>/runs/<runId>/` prefix
  in pages of at most 1000 keys and deletes every returned object, so a
  stale run leaves no artifacts behind regardless of how many kinds it has.
- `deleteSessionArtifacts` performs the same **total session-prefix sweep**
  under `temp/character-sheets/v1/sessions/<sessionId>/`, so a session
  deletion/expiry leaves no orphaned artifacts regardless of run status.
- Both sweeps share one pagination-safe helper: list by exact trailing-slash
  prefix, delete each page, repeat until no objects remain, and stay
  idempotent (an empty prefix deletes nothing).
- Both prefixes end with a trailing separator, so a session or run id is
  never a string prefix of a distinct id: `session-a` cannot match
  `session-a2` and `run-1` cannot match `run-10`.
- Cleanup failure surfaces as `cleanup_failed`; the caller (14.7D
  orchestration/cleanup sweep) retries against the D1 run/session operational
  records, not an artifact inventory.

This is implemented in 14.7B.

## 14.7B write compensation requirement (acceptance condition)

`putRunArtifacts` writes `spec.json` first, then `sheet.pdf`. If a later write
fails after an earlier one succeeded, the write must not leave a partial or
orphaned run behind:

- spec PUT fails → nothing was written → no compensation → `storage_unavailable`.
- spec PUT succeeds, PDF PUT fails, compensation cleanup succeeds →
  `storage_unavailable`, with **zero run artifacts remaining**.
- spec PUT succeeds, PDF PUT fails, compensation cleanup fails →
  `cleanup_failed`, so the caller knows cleanup still needs retry/recovery.
  The compensation failure is never masked as an ordinary storage error.

Compensation removes the **entire run prefix**, not just the two known objects,
so it also clears any pre-existing or future artifacts belonging to that run.
This is implemented in 14.7B.

## Editable authoring surface (14.7E)

Generated sheets stay editable before export. 14.7E ships the **draft domain**
and the **R2 draft store adapter**; the web rehydration store interfaces and
the glance-edit UI are the next slice.

### Draft package

`@repo/character-sheet-draft` is a pure, dependency-free domain package (no
React, no Cloudflare, no Drizzle) — the same technology-neutral rule as the
other character-sheet packages. It defines:

- **Surface model.** A `CharacterSheetDraft` is a _bounded surface_: up to 192
  fields and 192 values, every draft key on the safe field-key alphabet
  (`A-Za-z0-9._:-`, so every draft key is a valid `CharacterSheetSpec` field id
  and a path-safe R2 segment — the same guard as the artifact keys policy).
  Field types: `text`, `number`, `textarea`, `checkbox`, `choice`. Drafts are
  system-agnostic: no game-system rules live in the package.
- **Character-name boundary.** `characterName` is a derived display convenience
  that must mirror `values["character_name"]` (or `null`); a mismatch fails
  validation (`invalid_draft`). No dual source of truth.
- **Read locks and reroll ownership.** Each field carries `locked`.
  Locked fields carry a "draw grammar" — a `choice` lock declares `options`, a
  `number` lock declares `min`/`max` — so rerolling a locked field is a
  deterministic, seeded redraw, never free text editing. Unlocked fields are
  freely editable. Reroll uses the shared seeded PRNG (`deterministic.ts`, no
  `Math.random`): the same `(mode, seed)` reproduces the same values, explicit
  values always win, and every drawn value stays in bounds.
- **Versioned immutable snapshots.** A draft identity is
  `(sessionId, draftId)`; `version` starts at `1` and every persisted snapshot
  is a full, immutable `v<version>.json`. Mutation/preview never rewrites
  history. Future concurrency is belated-write detection via
  `assertDraftVersion`, not a CRDT.
- **Guided-edit edits map.** Future client edits are described as an ordered,
  order-preserving map of typed additions/updates/deletes against surface keys.
  When values belong to unknown keys, the map is a plain record; when the map
  itself is unwieldy, an alternate map keyed on `type` preserves per-type
  ordering (`draftStoreKey`). In-flight rules keep R2 writes single-put and
  idempotent by version.
- **Order-preserving mutation API.** `applyDraftMutation` applies single ops
  (`set_value`, `unset_value`, `add_field`, `remove_field`, `rename_field`,
  `set_label`, `toggle_read_lock`, `unlock_field`) and rejects invalid targets
  with a typed taxonomy (`invalid_mutation`, `field_read_locked`,
  `draft_session_mismatch`, `session_expired`, `surface_out_of_bounds`,
  `draft_inflight`).
- **One port.** `CharacterSheetDraftStore`:
  `putDraft(draft)`, `getDraftVersion(identity, version)`,
  `listDraftVersions(identity)`, `getLatestDraft(identity)`,
  `deleteDraft(identity)`. Transport-neutral error taxonomy:
  `invalid_draft | invalid_draft_identity | corrupt_draft |
storage_unavailable | cleanup_failed` (plus the domain codes above).

### Draft keys and lifetime

Drafts live under the **same session tenant as run artifacts**, as a sibling
of `runs/`:

```text
temp/character-sheets/v1/sessions/<sessionId>/drafts/<draftId>/v<version>.json
```

- Identities ride the same `draftPathSegment` policy as `artifactPathSegment`
  (non-empty, ≤128 chars, no `/`, `\` or `..`, percent-encoded), and every
  snapshot key embeds both opaque identities.
- Draft snapshots are temporary state, not persistent user resources: they are
  never event logs, never D1 rows, and never referenced from D1.
- **The 14.7B total session-prefix sweep already covers drafts by
  construction**: `deleteSessionArtifacts(sessionId)` lists the whole
  `.../sessions/<sessionId>/` prefix (pages of at most 1000 keys) and deletes
  every object, so the `drafts/` subtree is wiped with `runs/`. A dedicated
  regression suite remotely-verifies this cross-adapter behavior in workerd.
- `deleteDraft` exposes single-draft prefix cleanup for a client that abandons
  one open draft without ending the session.

### R2 binding

Drafts reuse the existing local-only `SHEET_ARTIFACTS` binding; no new bucket,
binding, or remote identity is added in 14.7E.

## Runtime and testing

Verified suites (all green in the current Phase 14.7E working tree):

- `@repo/character-sheet-template`: 21 tests / 3 files (template schema,
  extraction gate, reference extractor).
- `@repo/character-sheet-schema`: 26 tests / 1 file.
- `@repo/character-sheet-generation`: 401 tests / 21 files (includes the
  GUI-only regression suite, template-normalization, deterministic local name,
  and template-service suites).
- `@repo/character-sheet-pdf-renderer`: 38 tests / 3 files (renderer, the
  GUI-only PDF integration test, and the template-backed PDF integration test).
- `@repo/character-sheet-session`: 22 tests / 1 file (port contract suites).
- `@repo/character-sheet-artifacts`: 23 tests / 3 files (keys with
  similar-prefix isolation, serialization, port reference store).
- `@repo/character-sheet-draft`: 73 tests / 9 files (schema boundaries,
  authoring-session ownership, guided-edit surface, mutation API, reroll
  determinism and locked-field protection, preview projection + spec writeback,
  versioning and identity/keys).
- `rules-worker` node suite: 116 tests / 8 files (includes the fake-bucket
  adapter suites for artifacts and drafts, deterministic multi-page cleanup,
  total run/session prefix cleanup, and write compensation).
- `rules-worker` workerd suite: 110 tests / 16 files (includes the real-D1
  sheet-session 8-test, sheet-run 15-test repository suites, the real-R2
  `SHEET_ARTIFACTS` adapter suite, and the real-R2 draft adapter suite with the
  session-sweep regression proving `deleteSessionArtifacts` also wipes drafts).

## Deferred work

- **Server-wired Workshop path** — Turnstile verification widget and the
  production `SheetApiClient` route to rules-worker. The client-side switch
  exists (`NEXT_PUBLIC_CHARACTER_SHEET_BACKEND=remote`), but rules-worker fails
  closed (`403 HUMAN_VERIFICATION_REQUIRED`) without a configured Turnstile
  secret, so development defaults to the in-memory local backend
  (`createLocalSheetBackend`) which runs the same draft-domain rules. Also
  deferred: **PDF export/download [IMPLEMENTED]** and **PC/NPC mode selection [IMPLEMENTED]** in the workshop UI.
- **14.7C remainder** — production template extraction from external rulebook
  sources and the production `RulebookFieldDerivationPort` adapter, marked
  legacy/superseded for the template-backed flow. This is distinct from the
  temporary user-uploaded character-sheet extraction delivered below.
- **14.7D** — HTTP orchestration: session creation/authorization, run
  management, ownership validation, artifact preview/download. Not present
  today.

## 14.7B delivered slice [COMPLETED]

Delivered in 14.7B:

```text
CharacterSheetSpec / PDF
  → CharacterSheetArtifactStore port   (@repo/character-sheet-artifacts)
  → createR2CharacterSheetArtifactStore  (rules-worker R2 adapter)
  → controlled ownership/keying          (trailing-slash session/run prefixes)
  → retrieval                            (spec re-validated, pdf bytes)
  → write compensation                   (failed PDF write sweeps whole run prefix)
  → total cleanup                        (run + session prefix sweep)
```

The D1 session/run tables remain the source of cleanup candidates; 14.7D's
orchestrator and sweep use them to call `deleteRunArtifacts` /
`deleteSessionArtifacts`.

## 14.7C delivered slice [COMPLETED]

Delivered in 14.7C:

```text
blank sheet template                          (@repo/character-sheet-template)
  → CharacterSheetTemplateExtractionPort        (provider-agnostic; system/user contract)
  → extractSheetTemplate                         (schema gate + bounded replay)
  → reference extractor                          (offline catalog: no provider)
  → normalizeTemplateFields                      (template → SourceResolvedFields, sheet-template origin)
  → overlayTemplateWithGui                       (template authority + GUI overlay,
                                                 TEMPLATE_BOUND/CATEGORY disagreements visible)
  → resolveUnifiedSheetDefinition                (Level-2 + Level-1, unchanged)
  → DeterministicLocalNamePort                   (seeded, locale-aware, AI-free name default)
  → generateCharacterSheetSpec                   (Level-3, unchanged)
```

Template-semantics highlights:

- **Template source model.** `CharacterSheetTemplateSourceSchema` supports
  `direct-sheet` and `rulebook-contained-sheet`; the extraction port receives
  only the source reference, never raw text or rendered values.
- **Template authority.** The template owns the field roster, category,
  section grouping and printed bounds; a GUI authoring request overlays
  values on top. Template `TEMPLATE_MODE_MISMATCH` returns a dedicated
  `{ kind: "template_mode_mismatch" }` outcome before any merge.
- **Visible conflicts.** Template-bound disagreements surface as generation
  conflicts (`TEMPLATE_BOUND_DISAGREEMENT`,
  `TEMPLATE_CATEGORY_DISAGREEMENT`) rather than silent winners, and duplicate
  template labels are rejected (`DUPLICATE_TEMPLATE_FIELD_LABEL`).
- **Deterministic name default.** The standalone template-backed flow never
  depends on a model for a usable character name; an AI `namePort` is an
  explicit override, not the default.
- **Renderer integration proof (spike-verified).** The template-backed path
  renders a genuine RPG Forge-authored PDF: section order/titles come from the
  template's declared sections, template field kinds (text/textarea/number)
  reach the compiled spec, explicit GUI values land inside template bounds and
  blanks stay blank, seeded NPC values stay in-bounds and reproduce reliably,
  a merged GUI-only mechanical field still renders, and the output embeds no
  source-sheet raster artwork (zero image XObjects) — any in-sheet artwork is
  _not_ copied into the generated PDF. `spec.rulesContextId` stays null and
  `sourceMap` is empty, so no provenance or source-page decoration is applied.
- **No persistence impact.** This slice adds no D1 tables, no migrations, no
  new R2 artifact kinds, and no HTTP surface. Templates remain inputs to
  generation, not stored resources.

## 14.7E delivered slice [COMPLETED]

Delivered in 14.7E:

```text
CharacterSheetSpec / PDF   (final run, unchanged)
  → CharacterSheetDraft         (@repo/character-sheet-draft surface domain)
  → guided edits / mutation API (order-preserving single ops; typed taxonomy)
  → reroll                      (seeded PRNG, read-locked draw surface)
  → preview / writeback         (draft ↔ CharacterSheetSpec projection)
  → versioned snapshots         (immutable v<version>.json; no event log)
  → CharacterSheetDraftStore    (port: put/get/list/latest/delete)
  → createR2CharacterSheetDraftStore (rules-worker R2 adapter)
  → same session tenant         (14.7B session sweep covers drafts by design)
```

Authoring-semantics highlights:

- **Editable surface, not a spec.** The draft is a bounded field/value surface
  that stays editable before export; the final `CharacterSheetSpec` remains
  authoritative for export. `projectDraftToSpec` / `writebackDraftToSpec` are
  the explicit two-way projection boundary and fail closed
  (`projection_invalid`, `writeback_invalid`).
- **Deterministic reroll.** Locked fields keep a draw grammar (`number`
  bound / `choice` options); reroll draws through the shared seeded PRNG with
  no `Math.random`, so the same `(mode, seed)` reproduces the same values and
  every sampled value stays in bounds. Unlocked/edited values are never
  overwritten.
- **Versioned immutability.** Versions start at 1 and are never rewritten;
  edits append new versions, and concurrent writers are detected
  (`assertDraftVersion`) rather than merged.
- **Cleanup by construction.** Draft keys sit under
  `.../sessions/<sessionId>/drafts/` in the existing `SHEET_ARTIFACTS` tenant;
  `deleteSessionArtifacts` already wipes them (pinned by a workerd regression
  suite), and `deleteDraft` cleans up a single abandoned draft.
- **No D1, no new bindings.** Drafts add zero D1 tables and zero migrations,
  and reuse the local-only `SHEET_ARTIFACTS` binding.

## 14.7G delivered slice [COMPLETED]

Delivered in 14.7G:

```text
web store contract                       (@repo/character-sheet-schema client port)
  → createSheetStore                      (web transient session store; real domain fns)
  → useSheetStore                         (React binding; smallest "use client" boundary)
  → createLocalSheetBackend               (in-memory SheetApiClientPort: default dev backend)
  → SheetApiClient                        (HTTP client; NEXT_PUBLIC_CHARACTER_SHEET_BACKEND=remote)
  → rules-worker confirm whitelist        (evidence-free restricted config for the confirm route)
  → Character Workshop UI                 (/character-sheets route)
      ├─ creation-mode landing           (blank draft / loaded example, dev-badged)
      ├─ workspace toolbar               (brand, sheet-title input, save-status pill)
      ├─ sidebar field roster            (n/192, add-field)
      ├─ schema-driven FieldEditor       (text/number/textarea/checkbox/choice, locked-aware)
      ├─ live preview                    (projectDraftToSpec validation + surface render)
      └─ confirm → read-only exported    (finalizeDraft; single version bump; start over)
```

Web-surface highlights:

- **Store lifecycle.** `createSheetStore` wraps `SheetApiClientPort` in a
  transient session store: backend selection by environment
  (`NEXT_PUBLIC_CHARACTER_SHEET_BACKEND`, default `"local"`; `"remote"` →
  `SheetApiClient`). `startSession` → `createDraft` → mutation/reroll/confirm;
  `applyMutation` returns a typed `SheetStoreMutationOutcome`
  (`ok | rejected | not_ready | inflight | error`) so UI surfaces domain
  rejections verbatim. Confirmed drafts are read-only forever; "Start over"
  resets the store.
- **No double bump.** `applyDraftMutation` does not bump the draft version;
  the commit path is `validateDraft(bumpDraftVersion(mutated))`. `finalizeDraft`
  already bumps, so the confirm path is `confirmDraft` = `validateDraft(finalizeDraft(current))`
  with no extra bump (regression pinned by a store test).
- **Schema-driven editors.** `FieldEditor` renders only the five
  `DraftField.type` primitives; no game-system components or hardcoded labels.
  Locked/confirmed fields are read-only. `AddFieldDialog` mirrors the domain
  `add_field` schema (key slugification, `type`, bounds/options) and surfaces
  client + domain validation.
- **Local dev backend.** rules-worker fails closed (`403
HUMAN_VERIFICATION_REQUIRED`) without a Turnstile secret, so development uses
  `createLocalSheetBackend` — an in-memory `SheetApiClientPort` running the
  real domain rules (`applyDraftMutation`, `finalizeDraft`,
  `rerollLockedDraftValues`, `validateDraft`, `bumpDraftVersion`,
  `initialDraftVersion`) — keeping the store/UI indistinguishable from the
  server path. `startSession` uses a nonce token (`"local-turnstile-bypass"`)
  in local mode only. Fixtures (`createBlankDraft`, `createExampleDraft`)
  are dev-only and never imported by production flows.
- **Theming.** Forge/cartography theme as a scoped `.character-workshop` token
  block in `globals.css` (wood/parchment/leather/ink/metal), mirroring the
  `.dice-roller` convention; no design-system over-engineering.
- **No persistence impact.** 14.7G adds no D1 tables, no migrations, no new R2
  bindings, and no production AI providers. Confirmed drafts without
  export/download remain an in-memory terminal state.

Verified suites added in 14.7G (web, all green):

- store suite: `sheet-store.test.ts` — lifecycle, mutation outcomes, single
  version bump on confirm, start-over reset
- API client: `sheet-api-client.test.ts` — payload-shape fixes (`confirmed`,
  `as const` status)
- workshop UI: `CharacterWorkshop.test.tsx` — full manual loop
  (create → rename → add number field → value → confirm → read-only → start
  over) and dialog-side domain rejection
- local backend: `local-sheet-backend.test.ts` — port contract with real rules
- pre-existing test-file type fixes listed in the commit's diff

## Temporary Uploaded Sheet Extraction

The standalone Character Workshop can now extract an editable draft from one
user-uploaded PDF, PNG, or JPEG through the protected remote Worker path:

```text
browser File (<= 8 MiB, multipart/form-data)
  → same-origin character-sheet proxy (binary forwarding, whitelist)
  → authorized temporary sheet session + extraction rate limit
  → browser rasterizes PDF pages / normalizes images to JPEG
  → Cloudflare Workers AI vision adapter
  → validated ExtractedCharacterStructure (flat observed nodes rebuilt as a tree)
  → deterministic structure compiler
  → validated CharacterSheetDraft
  → existing store/editor flow
```

- The document and conversion output are processed in memory only: neither is
  stored in D1, R2, logs, or the draft response.
- The Worker accepts exactly one `document` form field, validates the MIME type
  (`application/pdf`, `image/png`, `image/jpeg`) and the 8 MiB maximum again on
  the server, requires the sheet-session bearer token, and consumes a dedicated
  per-IP extraction rate-limit key.
- The project-owned vision adapter receives only normalized page images. It asks
  the configured server-side model to observe flat `id`/`parentId` nodes, then
  validates and rebuilds the hierarchy before the deterministic compiler creates
  the draft. The model never receives RPG Forge keys, session metadata, or UI
  concepts.
- The compiler derives safe unique keys, generic control types, section parent
  links and field membership. It does not infer game-system mechanics or add
  system-specific fields. Markdown conversion is not a functional dependency of
  uploaded-sheet extraction.
- The protected remote extraction path is selected by default. The local
  extraction double is available only when explicitly selected for isolated
  development and rejects uploads rather than fabricating fields from a file
  name. `NEXT_PUBLIC_CHARACTER_SHEET_BACKEND=local` must not be used to test
  document extraction.

## Related documents

- ADR-056 — Deterministic character-sheet final construction
- ADR-057 — Editable character-sheet drafts (surface model + rehydration
  snapshots)
- ADR-015 / ADR-052 — PDF export stack and workerd AcroForm renderer
- ADR-054 — Zod 4 as canonical runtime validation
- Phase 14.6 — Character-Sheet PDF Renderer
- Phase 14.5 — Character-Sheet Generation
- `docs/architecture/data-model.md` — persistence direction (read for scope
  of D1/R2 responsibilities)
