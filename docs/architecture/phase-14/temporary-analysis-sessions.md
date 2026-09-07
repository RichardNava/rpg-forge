# Phase 14.2 Temporary Analysis Sessions

**Status:** Implemented
**Date:** 2026-09-08

## Purpose

Phase 14.2 delivers the production foundation for future anonymous rulebook
analysis: a temporary, bearer-authenticated **Rules Analysis session** that is
created through `apps/rules-worker`, persisted as operational metadata in local
D1, and automatically cleaned up after a fixed lifetime.

A session is temporary operational state, not a user resource. It exists so a
future upload/analysis phase can bind resources (rulebook files, extraction
state, generated content) to an identity that does not require an account. This
phase implements no product feature: no upload, no extraction, no AI, no
generation, and no UI.

## Threat Model

The session API is public and must defend an unauthenticated attacker against:

- **Credential theft/replay** — the bearer token is high-entropy, only ever
  stored as a SHA-256 hash, and only ever sent over authenticated request
  headers.
- **Enumeration** — knowing the opaque `analysisId` grants nothing; unknown
  ids and wrong tokens return byte-identical `404` responses so an attacker
  cannot distinguish an existing session from a missing one.
- **Abuse / quota exhaustion** — session creation is rate limited and gated by
  a human-verification (Turnstile) boundary before any D1 write.
- **Credential leakage via URLs** — tokens are rejected unless carried in the
  `Authorization` header; query-string tokens are rejected.
- **Resource leak through failed deletion** — deletion is retry-safe so a
  failed cleanup never silently loses the row or orphans resources.
- **Misconfiguration** — if a required production rate-limit binding is
  missing, session creation fails closed instead of degrading to an
  in-memory limiter.

## Anonymous Session Model

Each session is anonymous and self-contained:

- `analysisId`: opaque, non-sequential, created with `crypto.randomUUID()`.
- `accessToken`: an independent 256-bit bearer credential returned **exactly
  once** at creation.
- No user account, phone number, email, or profile is involved.

Sessions are temporary even though they are materialized in D1. There is no
campaign, library, saved-resource, or user persistence model.

## analysisId vs accessToken

`analysisId` is a public identifier. `accessToken` is the only credential.

- The token is generated independently with `crypto.getRandomValues()`; it is
  never derived from the id and never generated with `Math.random()`.
- `SessionCrypto.uuid()` and token generation are separated in the port so the
  two values cannot collide or be correlated.
- Authorization always requires both the id and the token (`authorizeSession`
  in `packages/rules-analysis-session/src/services.ts`).

## Secure accessToken Generation

`generateAccessToken(ACCESS_TOKEN_BYTE_LENGTH, crypto)` creates 32 random
bytes and encodes them URL-safe base64 (43 characters, unpadded) via the
project-owned `toBase64Url` helper. Byte length is validated
(`crypto.ts:isValidTokenByteLength`) to reject invalid requested sizes.

## SHA-256 Token Hashing

The plaintext token is never persisted. On creation the worker returns it once
and the application stores only `sha256(token)`:

- Persistence stores `token_hash` only (`createAnalysisSession`).
- `verifyTokenHash` hashes the supplied bearer token and compares digests with
  a constant-time byte compare (`encoding.ts:constantTimeEqual`).
- Malformed stored hashes (non-hex or wrong length) are rejected safely and
  fail verification.
- A random 256-bit bearer token needs no password KDF.

## Authorization Behavior

`authorizeSession(analysisId, accessToken, deps)` returns:

- `ok` with the session when id and token match and the session is not
  expired;
- `expired` when the credentials are valid but the 12-hour lifetime has
  passed;
- `not_found_or_unauthorized` when the id is unknown **or** the token is
  wrong — intentionally indistinguishable.

The HTTP layer maps these to `200`, `410`, and `404` respectively.

## Fixed 12-Hour Lifetime

`SESSION_LIFETIME_MS` is 12 hours from creation. `expiresAt` is computed once
at creation and stored. Expiration is derived from `expiresAt`; there is no
third persisted state.

## No Sliding Expiration

Reading, authorizing, or using a session never extends `expiresAt`. Unit tests
cover that repeated `GET` requests do not postpone expiration, and an expired
session returns `410` even with valid credentials.

## D1 Operational Metadata

`apps/rules-worker` persists only the `rules_analysis_sessions` table
(`src/infrastructure/db/schema.ts`):

| Column      | Type    | Purpose                         |
| ----------- | ------- | ------------------------------- |
| analysis_id | text PK | opaque id                       |
| token_hash  | text    | SHA-256 of the returned token   |
| status      | text    | `ACTIVE` or `DELETING`          |
| created_at  | int ms  | creation timestamp (UTC)        |
| updated_at  | int ms  | last transition timestamp (UTC) |
| expires_at  | int ms  | fixed 12-hour expiration (UTC)  |

The D1 session table exists only for this temporary operational state. There
is no table for campaigns, resources, generations, saved tables, plans,
subscriptions, entitlements, lore packs, or user sources. The `DB` binding is
local-only with no remote `database_id`; the single Drizzle migration
(`drizzle/0000_blue_logan.sql`) creates the table and a `(status, expires_at)`
cleanup index.

## ACTIVE / DELETING Lifecycle

Only two operational statuses exist:

- `ACTIVE` — normal session eligible for authorization and cleanup.
- `DELETING` — cleanup in progress (`cleaner` invoked) or interrupted; the
  row is retained for retry until deletion succeeds.

Process-status states (`building`, `conflicts`, `ready`, ...) belong to future
analysis phases and are deliberately absent.

## Explicit Deletion

`DELETE /v1/rules-analysis/sessions/:analysisId` with a valid bearer token
runs:

```text
authorize (analysisId + bearer token)
    ↓
atomic markDeletingIfActive  (ACTIVE -> DELETING, guarded update)
    ↓
AnalysisResourceCleanerPort.cleanup(analysisId)
    ↓
SessionRepositoryPort.delete(analysisId)  (row removed)
```

Replayed deletes are idempotent: the second delete returns the same
`not_found_or_unauthorized` shape as an unknown id. Cleanup failures surface
`500 ANALYSIS_SESSION_DELETE_FAILED` and leave a retryable `DELETING` row.

## Scheduled Expiry Cleanup

The Worker `scheduled` handler calls `runExpiryCleanup` on every trigger. It
selects a bounded batch of candidates where:

```text
status = ACTIVE  AND expires_at <= now
OR
status = DELETING AND updated_at is stale (CLEANUP_RETRY_GRACE_MS)
```

Each candidate is transitioned, cleaned, then deleted. A single failure is
isolated and reported; it never corrupts other sessions in the batch.

## Retry-Safe Cleanup Behavior

A cleanup failure during explicit deletion or scheduled cleanup leaves the row
in `DELETING` with a fresh `updated_at`. The grace window
(`CLEANUP_RETRY_GRACE_MS`, 1 hour) prevents immediate hot-loop retries, and
both `deleteSession` and `runExpiryCleanup` treat `DELETING` rows as retryable.
Unit tests cover first-failure-then-retry and cross-session isolation.

## AnalysisResourceCleanerPort Extension Point

`AnalysisResourceCleanerPort.cleanup(analysisId)` is injected into the session
lifecycle. Phase 14.2 owns no permanent attached resources, so the production
adapter (`src/infrastructure/cleaner.ts`) is an explicit no-op. Future phases
compose R2 object deletion, Vectorize record removal, or Workflow cleanup
behind this same port without changing session lifecycle code.

## Turnstile Boundary

`POST /v1/rules-analysis/sessions` requires a Turnstile token in the request
body. `createTurnstileHumanVerification` (`src/infrastructure/turnstile.ts`)
performs server-side `siteverify` with the `TURNSTILE_SECRET` binding and
**fails closed**:

- Missing or empty secret -> `unavailable` -> `403 HUMAN_VERIFICATION_REQUIRED`;
- network error, non-OK response, or malformed body -> `unavailable`;
- `success: false` -> `failed` -> `403 HUMAN_VERIFICATION_FAILED`.

The `remoteip` field is passed to Turnstile when `cf-connecting-ip` is
available. No Turnstile result or token is persisted.

## RateLimitPort Boundary

`RateLimitPort.consume(key)` returns a discriminated result mirroring the
human-verification port:

- `{ kind: "allowed" }` — request may proceed;
- `{ kind: "denied" }` — legitimate quota exceeded (`429 RATE_LIMITED`);
- `{ kind: "unavailable" }` — rate-limit infrastructure is not usable
  (`503 RATE_LIMIT_UNAVAILABLE`).

The production adapter wraps the Cloudflare `RATE_LIMITER` binding
(`binding.limit({ key })`) and maps `success` to allowed/denied; a thrown
binding call is treated as `unavailable`, never as silent success.

## Local/Test Rate-Limit Fallback Policy

A deterministic fixed-window in-memory limiter
(`createInMemoryRateLimiter`, 20 requests per 60 seconds per key) is used:

- in unit tests via injected fakes (`FakeRateLimiter`); and
- in local development **only** when the environment explicitly declares
  intent with `RATE_LIMIT_MODE=local` (documented in `.dev.vars.example`).

Local development must set `RATE_LIMIT_MODE=local` explicitly.

## Production Fail-Closed Rate-Limit Policy

**The safe default is fail closed.** In production/default intent — any value
of `RATE_LIMIT_MODE` that is not the literal `local`, including an absent
setting — session creation requires the Cloudflare `RATE_LIMITER` binding:

```text
production/default + RATE_LIMITER present   -> allowed / denied by binding
production/default + RATE_LIMITER missing   -> unavailable -> 503, NO session
explicit local mode (RATE_LIMIT_MODE=local) -> in-memory fallback allowed
```

The development switch never defaults to enabled, and environment intent is
never inferred from an absent binding or an implicit runtime heuristic. A
missing required production binding therefore produces **no D1 session row**.

## HTTP API Routes

`apps/rules-worker` exposes:

| Method | Route                                     | Behavior                                              |
| ------ | ----------------------------------------- | ----------------------------------------------------- |
| POST   | `/v1/rules-analysis/sessions`             | create (rate limit, then Turnstile, then D1) -> `201` |
| GET    | `/v1/rules-analysis/sessions/:analysisId` | public view, bearer required -> `200`                 |
| DELETE | `/v1/rules-analysis/sessions/:analysisId` | delete, bearer required -> `200`                      |

Unknown routes and unhandled methods return `404 INVALID_REQUEST`.

## Structured Error Contract

All error responses share a Zod-validated shape
(`src/transport/errors.ts`):

```json
{ "error": { "code": "<ErrorCode>", "message": "<string>" } }
```

Error codes: `INVALID_REQUEST` (400), `HUMAN_VERIFICATION_REQUIRED` /
`HUMAN_VERIFICATION_FAILED` (403), `RATE_LIMITED` (429),
`RATE_LIMIT_UNAVAILABLE` (503),
`ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED` (404),
`ANALYSIS_SESSION_EXPIRED` (410), `ANALYSIS_SESSION_DELETE_FAILED` (500),
`INTERNAL_ERROR` (500). Request bodies are bounded (16 KB) and parsed with
strict Zod schemas (`strictObject`) so unknown properties are rejected.

## Privacy and Session Enumeration Protection

- `analysisId` alone is never sufficient; the token is required.
- Unknown id and wrong token are indistinguishable (`404`) with byte-identical
  error bodies.
- A token for session A cannot read or delete session B.
- The public session view excludes `tokenHash` and any internal fields.
- Tokens are accepted only through the `Authorization: Bearer <token>` header;
  a token placed in a URL query string is rejected without authorization.

## Cache-Control: no-store

Every response (success and error) is sent with
`Cache-Control: no-store` because session credentials and results are
sensitive and must not be cached by any intermediary.

## Raw IP Non-Persistence

The client IP (`cf-connecting-ip`) is used only transiently:

- as the rate-limit key (`create-session:<ip>`); and
- as Turnstile `remoteip`.

It is never written to D1, never returned in any response, and never logged in
this phase. The D1 schema contains no IP column.

## Cleanup Batch Bounding

`runExpiryCleanup` processes at most `MAX_CLEANUP_BATCH_SIZE` (100) sessions
per scheduled run. The repository `findCleanupCandidates` applies the same
limit at the SQL level. This caps per-trigger D1 and cleaner work so a backlog
cannot block the event loop or exhaust execution time.

## Concurrency / CAS Strategy

Transitions are race-safe at the row level:

- `markDeletingIfActive` issues a guarded update
  `UPDATE ... SET status='DELETING', updated_at=now WHERE id=? AND status='ACTIVE'`.
- A nonzero `meta.changes` means this call won the transition.
- Otherwise the adapter reads the row once to distinguish `already_deleting`
  (a concurrent deleter or retry) from `not_found`.

This atomic compare-and-swap prevents two concurrent deletions from
double-cleaning or deleting a session in the wrong state. Expiry cleanup and
explicit deletion share the same transition and therefore cannot conflict.

## Local And Workerd Testing Model

- **Pure package** (`@repo/rules-analysis-session`): deterministic fakes
  (fake clock, fake crypto, in-memory repository, recording cleaner); 36 unit
  tests cover encoding, token hashing, creation, authorization, deletion, and
  bounded cleanup.
- **Worker unit** (`apps/rules-worker`, vitest/node): injected
  `FakeRateLimiter`, `FakeHumanVerification`, `FakeSessionRepository` drive
  `handleRequest`; covers routing, validation, ordering (rate limit before
  Turnstile before D1), fail-closed rate limiting, and error shapes.
- **Rate-limit boundary** (`src/infrastructure/rate-limit.test.ts`): proves
  binding adapter use, binding-throw unavailability, explicit local-mode
  in-memory behavior, production/default fail-closed behavior, and that a
  missing production binding never reaches the in-memory limiter.
- **Workerd integration** (vitest-pool-workers): `worker.workerd.test.ts` runs
  the real worker against a real local D1 (via `cloudflare:test`),
  `repository.workerd.test.ts` exercises the D1 repository contract
  (round-trip, CAS transition, cleanup candidates, limits). The turnstile
  fail-closed integration test uses explicit `RATE_LIMIT_MODE=local` so it
  reaches the turnstile gate; the production fail-closed test omits the
  binding and asserts the row count does not change.

Tests never call external services; crypto correctness is covered against real
Web Crypto through `webCrypto`.

## Deferred Production Cloudflare Resource Wiring

No remote Cloudflare resources are created in Phase 14.2:

- **Rate Limiting binding** — `wrangler.jsonc` keeps the `ratelimits` block
  commented out. When production wiring is approved, add the account-unique
  namespace id and enable the binding; until then production fails closed
  (`503 RATE_LIMIT_UNAVAILABLE`) when the binding is absent.
- **D1** — the `DB` binding is local-only with no remote `database_id`;
  `rpg-forge-dev` / `rpg-forge-prod` remote ids are added only when those
  environments are created.
- **Turnstile** — `TURNSTILE_SECRET` is supplied through Cloudflare secrets /
  local `.dev.vars`; it is never committed or exposed through public env vars.
- **R2, Vectorize, Workflows** — none are created; the resource-cleaner port
  is the only extension point for their future use.

## Deferred Product Features

Phase 14.2 explicitly defers all of the following. Their presence in earlier
documentation does not authorize implementation during this phase:

- rulebook upload;
- upload consent;
- R2 storage;
- PDF extraction;
- OCR;
- chunking;
- Workflows;
- AI.toMarkdown;
- Workers AI;
- embeddings;
- Vectorize;
- RAG;
- RulesContext generation;
- conflict review;
- character-sheet generation;
- PDF/AcroForm rendering;
- UI;
- presets;
- permanent persistence.

## References

- [Phase 14.1 Production Contracts](./production-contracts.md)
- [ADR-054: Zod 4 canonical schema](../adr/054-zod4-canonical-schema.md)
- [Phase 14.0 technical spikes](../spikes/phase-14/README.md)
