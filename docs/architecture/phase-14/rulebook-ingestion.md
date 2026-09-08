# Phase 14.3 Rulebook Ingestion (Temporary Upload)

**Status:** Implemented
**Date:** 2026-09-08

## Purpose

Phase 14.3 binds a rulebook PDF to a rules-analysis session: the user consents
to upload, the worker validates the document, persists it to a temporary R2
location, records extraction-staging metadata in D1, and schedules the durable
ingestion workflow. It is the first phase that materializes durable resources
under a session, and it adds the defensive boundaries (consent, upload limits,
content-type, PDF signature, replay-safe lifecycle) that the future extraction
and AI phases will rely on.

The phase implements **no** text extraction on the request path, no AI call,
no chunking, no OCR, and no user-facing UI. It only reserves, uploads, and
queues. The durable `RulebookIngestionWorkflow` orchestrates the extraction
steps (defined in `@repo/rulebook-ingestion`) once the upload is confirmed.

## Threat Model

The rulebook endpoint is bearer-scoped but still public-facing. It defends
against:

- **Consent bypass** — uploads require an explicit `x-rules-upload-consent:
accepted` header; a missing header returns `403 RULEBOOK_UPLOAD_CONSENT_REQUIRED`
  before any D1 write or R2 object.
- **Malicious payloads** — only `application/pdf` content-type is accepted;
  the declared `Content-Length` is checked against the 50 MiB limit before any
  object is written; the body is then re-checked while streaming and the first
  bytes must match a `%PDF-` signature.
- **Size-abuse via a lying `Content-Length`** — the handler validates against
  the _declared_ length early, but also enforces the same cap on the _actual_
  delivered bytes. A header that under-declares cannot smuggle an oversized
  object into R2.
- **Attachment contention** — a second upload for the same session returns
  `409 RULEBOOK_ALREADY_ATTACHED`; each attachment is a distinct `ingestionId`
  (generation), so a stale workflow can never touch a newer attachment.
- **Stale-generation mutation** — every rulebook state transition is guarded by
  the current generation/status (CAS) in D1. A workflow holding a stale
  `ingestionId` (or a late DELETE racing an upload) cannot overwrite the
  session's attachment.
- **Resource leak on failed upload** — any upload failure after reservation runs
  `removeRulebookGeneration`, which marks `DELETING`, terminates the workflow if
  one was started, deletes R2 artifacts, then removes the row. No orphan
  reservation survives a rejected body.
- **Storage / workflow misconfiguration** — a missing R2 bucket binding or
  missing workflow binding fails closed (`503 RULEBOOK_STORAGE_UNAVAILABLE` /
  `503 RULEBOOK_WORKFLOW_UNAVAILABLE`) before any reservation.

## Consent Boundary

Uploads require `x-rules-upload-consent: accepted`. The header

- is checked _first_ in `putRulebook` (`src/rulebook-handler.ts`), before
  storage, rate limit, and reservation;
- is not persisted anywhere (consent is a gate, not a recorded data point);
- returns `403 RULEBOOK_UPLOAD_CONSENT_REQUIRED` when absent.

The unit tests assert explicitly that a consent-free upload leaves **no** row
in D1 and **no** workflow creation.

## Upload Validation Order

`putRulebook` runs, in order:

```text
1. consent header             -> 403 RULEBOOK_UPLOAD_CONSENT_REQUIRED
2. content-type               -> 415 RULEBOOK_INVALID_CONTENT_TYPE
3. declared content-length    -> 413 RULEBOOK_TOO_LARGE
4. bounded body read          -> 400 RULEBOOK_INVALID_PDF
5. rate limit (per analysisId + client IP)
                              -> 429 RATE_LIMITED / 503 RATE_LIMIT_UNAVAILABLE
6. storage & workflow present -> 503 RULEBOOK_STORAGE_UNAVAILABLE
                                   / 503 RULEBOOK_WORKFLOW_UNAVAILABLE
7. reserve rulebook           -> 409 RULEBOOK_ALREADY_ATTACHED
8. PDF signature              -> 400 RULEBOOK_INVALID_PDF
9. R2 put raw
10. UPLOADING -> QUEUED (CAS)
11. workflow.start(ingestionId)
12. 202 { status: QUEUED, public view }
```

Failures after step 7 always run the generation-scoped cleanup, so no
reservation leaks.

## Upload Size Limits

- Upload cap is **50 MiB**, enforced twice:
  - eagerly against the declared `Content-Length` (`isDeclaredRulebookTooLarge`),
    returning `413 RULEBOOK_TOO_LARGE` before reading the body; and
  - while reading the actual body, so a shorter declared length is caught
    during delivery.
- Extra PDF-level caps (`RULEBOOK_TOO_MANY_PAGES`, `RULEBOOK_REQUIRES_OCR`)
  are **not** enforced on the upload path. They are enforced later by the
  processing workflow (`processRulebook` in `@repo/rulebook-ingestion`), which
  records a terminal processing failure. Extraction caps
  (`RULEBOOK_EXTRACTION_TOO_LARGE`, `RULEBOOK_TOO_MANY_CHUNKS`) also apply in
  the workflow.

## PDF Signature Check

`validatePdfUpload` rejects content whose first bytes are not a `%PDF-`
signature, mapping to `400 RULEBOOK_INVALID_PDF` and triggering the generation
cleanup. The workerd handler test uploads an explicit non-PDF body and asserts
no `rules_analysis_rulebooks` row survives.

## Processing Validations (Workflow, not Upload)

The following quality gates are **not** part of the upload path. They run
asynchronously in the rulebook processing workflow:

- `pageCount > 500`
  → `RULEBOOK_TOO_MANY_PAGES` (HTTP 422) → **terminal processing failure**
  (row becomes `FAILED` with `failure_code`).
- insufficient selectable/extracted text
  → `RULEBOOK_REQUIRES_OCR` (HTTP 422) → **terminal processing failure**.
- oversized extraction / too many chunks
  → `RULEBOOK_EXTRACTION_TOO_LARGE` / `RULEBOOK_TOO_MANY_CHUNKS` (HTTP 422).

These are enforced by `processRulebook` in `@repo/rulebook-ingestion`, not by
`validatePdfUpload`.

## Attachment Model: one rulebook per session, one generation per upload

A session holds at most one rulebook. Each upload creates a fresh
`ingestionId` (a `crypto.randomUUID()` generation). The rulebook row is keyed
by `analysisId`, and the `ingestionId` is unique. All staged R2 keys are
namespaced under `temp/rules/<analysisId>/<ingestionId>/`, so a stale
generation's objects are physically isolated from the current one.

The D1 `rules_analysis_rulebooks` table (`src/infrastructure/db/schema.ts`):

| Column              | Type     | Purpose                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| analysis_id         | text PK  | owning session                                                |
| ingestion_id        | text     | unique generation id (unique index)                           |
| status              | text     | `UPLOADING`/`QUEUED`/`PROCESSING`/`READY`/`FAILED`/`DELETING` |
| size_bytes          | integer  | accepted PDF size                                             |
| page_count          | integer? | set by extraction                                             |
| chunk_count         | integer? | set by chunking                                               |
| extracted_chars     | integer? | set by extraction                                             |
| failure_code        | text?    | terminal failure reason (only when `FAILED`)                  |
| created_at/_updates | int ms   | UTC timestamps                                                |

## State Machine

The rulebook lifecycle is a guarded progression:

```text
UPLOADING --(upload confirmed)--> QUEUED --(workflow)--> PROCESSING --(ok)--> READY
                                  |                            |
                                  `------ workflow failure ---> FAILED (failure_code)
PROCESSING/QUEUED --(workflow/validation fail)--> FAILED
FAILED/READY/(others) --(remove/expiry)--> DELETING --> row removed
```

`FAILED` is the terminal processing-error state: the row stays `FAILED` with a
`failure_code` and remains available for status inspection until either an
explicit Remove Rulebook or the parent AnalysisSession's expiry cleanup removes
it. `DELETING` is not the processing-error state; it is used only while
cleanup/removal is in progress.

Every transition is a CAS: `markQueuedIfUploading`, `ensureProcessing`,
`markReadyIfProcessing` all issue guarded updates and return the current row
when the transition did not win. Crucially, `README` is never reachable from
`DELETING`, and a stale workflow's `markReady` returns the _current_ (newer)
attachment instead of mutating the row (`src/infrastructure/db/rulebook-repository.ts`).

## DELETE Behavior

`DELETE /v1/rules-analysis/sessions/:analysisId/rulebook` (authorized):

```text
authorize active session
    ↓
authorizeRulebookAccess -> 404 RULEBOOK_NOT_FOUND if none attached
    ↓
workflow.terminate(ingestionId)  (no-op if already complete/errored/terminated)
    ↓
R2 delete of temp/rules/<analysisId>/<ingestionId>/**
    ↓
markDeleting (CAS) + delete row
    → 204 (no body)
```

The delete is idempotent and replay-safe: a second delete returns `204` with
no further destructive work (no R2 delete, no terminate), and a delete when no
rulebook is attached also returns `204`. The workflow-port adapter skips
`terminate` for `complete`/`errored`/`terminated` instances and swallows
"instance not found", so the DELETE can never surface a stale-workflow error as
a product failure.

## Stale-Workflow Isolation

The critical isolation property: _a stale workflow can never touch the current
attachment._ It is enforced twice:

1. Per-generation R2 keys — `temp/rules/<analysisId>/<ingestionId>/…`;
2. Generation-guarded D1 transitions — `markReadyIfProcessing` returns the
   current row when the generation is stale, so a late workflow step cannot
   promote the _new_ attachment.

The workerd handler test _upload A → DELETE A → upload B_ asserts that after
re-attachment, the R2 objects for `ingestionId A` are gone while B's raw exists,
and the D1 row points at B. The rulebook-repository workerd test covers the
CAS transitions and the no-README-after-DELETING guard directly.

## HTTP API Routes

| Method | Route                                              | Behavior                                      |
| ------ | -------------------------------------------------- | --------------------------------------------- |
| PUT    | `/v1/rules-analysis/sessions/:analysisId/rulebook` | consent + limits + PDF check + queue -> `202` |
| GET    | `/v1/rules-analysis/sessions/:analysisId/rulebook` | public rulebook view -> `200` / `404`         |
| DELETE | `/v1/rules-analysis/sessions/:analysisId/rulebook` | terminate + clean + remove -> `204`           |

All responses carry `Cache-Control: no-store`. The public view is
Zod-validated (`PublicRulebookSchema`) and exposes only `status`, `sizeBytes`,
`failure`, `pageCount`/`chunkCount`/`extractedChars` when populated, and
`createdAt`/`updatedAt` — never `ingestionId`, never the R2 key prefix, never
extracted text.

## Error Contract Additions

New error codes on top of the session phase (`src/transport/errors.ts`):

`RULEBOOK_UPLOAD_CONSENT_REQUIRED` (403),
`RULEBOOK_INVALID_CONTENT_TYPE` (415),
`RULEBOOK_TOO_LARGE` (413),
`RULEBOOK_INVALID_PDF` (400),
`RULEBOOK_ALREADY_ATTACHED` (409),
`RULEBOOK_NOT_FOUND` (404),
`RULEBOOK_STORAGE_UNAVAILABLE` (503),
`RULEBOOK_WORKFLOW_UNAVAILABLE` (503),
`RULEBOOK_PROCESSING_FAILED` (500),
`RULEBOOK_EXTRACTION_TOO_LARGE` (422),
`RULEBOOK_TOO_MANY_PAGES` (422) / `RULEBOOK_REQUIRES_OCR` (422) /
`RULEBOOK_TOO_MANY_CHUNKS` (422).

## Local and Workerd Testing Model

- **Pure package** (`@repo/rulebook-ingestion`): 19 unit tests cover upload
  validation, reservation/queue/process/ready transitions, generation-scoped
  removal, the workflow step orchestration, and the workflow-port contract.
- **Worker unit** (`apps/rules-worker`, vitest/node): the handler harness
  (`src/test/fakes.ts`) injects fake storage, fake workflow, and the in-memory
  rulebook repository. 20+ rulebook tests cover consent ordering, content-type,
  declared and lying content-length, PDF signature, rate limiting, storage/workflow
  fail-closed, replay-safe DELETE, the `202` queue path, and the
  upload/delete/re-upload isolation case.
- **D1 adapter** (`src/infrastructure/db/rulebook-repository.workerd.test.ts`):
  real D1 round-trips, `UPLOADING -> QUEUED -> PROCESSING -> READY`, the
  no-README-after-DELETING guard, and expired-batch candidates.
- **R2 adapter** (`src/infrastructure/r2-rulebook-storage.workerd.test.ts`):
  put/get/delete of raw artifacts, known-length storage, and per-generation
  key scoping against a real local R2 bucket.
- **PDF extractor** (`src/infrastructure/pdfjs-extractor.workerd.test.ts`):
  pdfjs runs in workerd; a 12-page fixture is extracted with a `DOMMatrix`
  shim, asserting page count and 1-based page enumeration.
- **Workflow adapter** (`src/infrastructure/rulebook-workflow.workerd.test.ts`):
  the `createCloudflareRulebookWorkflowPort` is exercised against a recording
  stub binding — start/terminate mapping, fail-closed on `create` throw,
  skip-terminate for `complete`/`errored`/`terminated`, swallow "instance not
  found", and fail-closed on `unknown`.
- **Handler integration** (`src/rulebook-handler.workerd.test.ts`): the real
  worker fetch with **real local D1 + real local R2** and a recording stub
  workflow binding (see limitation below).

### Documented limitation: full Workflow local execution

`vitest-pool-workers` provides workflow helpers (`introspectWorkflowInstance`,
`disableSleeps`), but running the _actual_ `RulebookIngestionWorkflow` inline
in this environment hangs (the pdfjs step cannot complete against a synthetic
body). Per the "test up to the supported limit" policy, the durable workflow
execution is therefore **not** driven to completion in local tests. Instead:

- the workflow's domain orchestration (`processRulebook`,
  `finalizeRulebookReady`, `recordTerminalRulebookFailure`) is unit-tested in
  the pure package with fakes;
- the port adapter is tested against a recording stub binding; and
- the handler integration test substitutes a stub binding so the real D1 + R2
  upload/delete path is exercised end-to-end without starting a real instance.

The `RulebookIngestionWorkflow` class itself (`src/rulebook-ingestion-workflow.ts`)
remains a thin, trivially-reviewable wrapper over those tested domain steps.
This limitation is expected to lift in a later phase if durable-queue stepping
(e.g. `ctx.do`, `ctx.sleep` sequencing) is tested against real `workerd`.

## vitest Version Pin

The rules-worker depends on `@cloudflare/vitest-pool-workers@0.21.3`. Loose
`satisfies ^4.1.10` resolution drifted vitest to 4.1.16, which hung all workerd
tests under the pool (the run printed only the `RUN` header). Pin
`"vitest": "4.1.10"` exactly in `apps/rules-worker/package.json`; do not bump
the pool-workers or vitest minor without re-validating `test:workerd`.

## Deferred Product Features

Still not implemented in this phase (present only as architectural direction):

- OCR, embeddings, Vectorize, RAG, `AI.toMarkdown`, Workers AI inference,
  RulesContext generation, conflict review, character-sheet generation,
  PDF/AcroForm rendering, UI, presets, permanent persistence, premium
  entitlements, and any realtime behavior.

## References

- [Phase 14.2 Temporary Analysis Sessions](./temporary-analysis-sessions.md)
- [Phase 14.1 Production Contracts](./production-contracts.md)
- `@repo/rulebook-ingestion` package tests for the domain state machine
