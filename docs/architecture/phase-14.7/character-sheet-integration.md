# Phase 14.7 Character-Sheet Integration — Generation Boundaries and Sheet Sessions

**Status:** Implemented (14.7A + 14.7B + 14.7C template-backed generation). The
phase-14.7 slices are spike/terminal evaluation landmarks proven by committed
automated suites; they are not yet product-facing UI features.
**Date:** 2026-09-13

## Purpose

Phase 14.7 wires the deterministic character-sheet construction (Phase 14.5)
and PDF renderer (Phase 14.6) into the temporary standalone generation model:
a genuine GUI-only path that needs no RulesContext, persistent session/run
bookkeeping in D1, clean temporary artifact storage in R2, and a clean
boundary for the still-deferred HTTP orchestration slice. 14.7C adds the
template-backed path: a blank sheet template can be extracted from a source
sheet and used as the authority for which fields a generated sheet contains.

This document describes the **actual committed architecture** after 14.7A,
14.7B and 14.7C. Planned slices are labeled explicitly as deferred and are
never described as implemented.

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
- **14.7B** — `@repo/character-sheet-artifacts`; the `CharacterSheetArtifactStore`
  port; R2 adapter in rules-worker; controlled object keys; content types and
  `Cache-Control: no-store` metadata; write compensation; retrieval; and total
  session/run prefix cleanup. Local-only `SHEET_ARTIFACTS` binding; production
  bucket identity deferred.
- **14.7C** — template-backed generation: `@repo/character-sheet-template`
  (template contracts, extraction port, reference extractor); generation-side
  template normalization and template/GUI overlay; the provider-free
  `DeterministicLocalNamePort` default for the standalone character name; and
  `generateTemplateBackedSheet` wiring. The production multimodal extraction
  provider is **blocked** (no vision model is committed) and remains the only
  deferred 14.7C item.

By design, Phase 14.7 adds **no** HTTP routes, **no** production AI providers,
**no** Workflow, and **no** UI.

## Boundaries

Implemented through 14.7C:

- domain contracts
- GUI-only final construction
- rulebook-capable final construction
- template-backed construction (template normalization + template/GUI overlay)
- deterministic PDF renderer
- sheet session/run persistence (D1 operational metadata only)
- temporary R2 artifact storage (spec + PDF per run, total prefix cleanup)

Deferred:

- production multimodal template extractor adapter (blocked: no vision model
  is committed) — the only remaining 14.7C item
- production `RulebookFieldDerivationPort` adapter — superseded for the
  template-backed flow; kept as a legacy port
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
construction, the deterministic PDF renderer, sheet session/run persistence,
and temporary R2 artifact storage. The web authoring UI, HTTP orchestration,
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

## Runtime and testing

Verified suites (all green in the current Phase 14.7C working tree):

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
- `rules-worker` node suite: 103 tests / 7 files (includes the fake-bucket
  adapter suite with deterministic multi-page cleanup, total run-prefix
  cleanup, and write compensation).
- `rules-worker` workerd suite: 107 tests / 15 files (includes the real-D1
  sheet-session 8-test, sheet-run 15-test repository suites, and the real-R2
  `SHEET_ARTIFACTS` adapter suite).

## Deferred work

- **14.7C remainder** — production multimodal template extractor. The port
  and reference extractor are implemented, but no production adapter can be
  written until a vision model is committed: only text and embedding models
  exist in configuration (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
  `@cf/google/embeddinggemma-300m`); vision types appear only in generated
  `cloudflare-env.d.ts` unions, not in any provider selection. There is no
  committed multimodal model. Also deferred: the production
  `RulebookFieldDerivationPort` adapter, marked legacy/superseded for the
  template-backed flow.
- **14.7D** — HTTP orchestration: session creation/authorization, run
  management, ownership validation, artifact preview/download. Not present
  today.
- **Later 14.7 slices** — web UI, preview, E2E.

## 14.7B delivered slice

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

## 14.7C delivered slice

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

## Related documents

- ADR-056 — Deterministic character-sheet final construction
- ADR-015 / ADR-052 — PDF export stack and workerd AcroForm renderer
- ADR-054 — Zod 4 as canonical runtime validation
- Phase 14.6 — Character-Sheet PDF Renderer
- Phase 14.5 — Character-Sheet Generation
- `docs/architecture/data-model.md` — persistence direction (read for scope
  of D1/R2 responsibilities)
