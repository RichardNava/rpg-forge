# @repo/rules-analysis-session

Framework-independent application logic for anonymous **temporary Rules Analysis
sessions**. This is the production foundation for later rulebook-upload phases;
it does not implement upload, extraction, RAG, conflict review, or sheet
generation.

## Boundaries

The package must not depend on Cloudflare bindings, D1 types, Workers APIs,
Node APIs, DOM APIs, or Next.js. Persistence, human verification, and rate
limiting are injected as ports; the production adapters live in
`apps/rules-worker`.

```text
@repo/rules-analysis-session  (pure application logic)
  ├── SessionRepositoryPort        - D1 adapter lives in worker
  ├── AnalysisResourceCleanerPort  - no-op today; R2/Vectorize later
  ├── SessionCrypto                - Web Crypto default; injectable in tests
  └── Clock                        - injectable system time
```

## Session identity

Each session has an opaque `analysisId` (`crypto.randomUUID()`) and a separate
256-bit `accessToken` (32 random bytes, base64url, 43 characters). Knowing the
`analysisId` alone never authorizes anything. Tokens are never derived from
IDs and never generated with `Math.random()`.

## Token hashing

The plaintext token is never stored. On creation the worker returns it once;
the application persists only the SHA-256 hash. Verification hashes the
supplied bearer token and compares hashes in constant time. No password KDF is
used: a random 256-bit bearer token does not need one. Malformed stored hashes
are rejected safely.

## Lifetime

`SESSION_LIFETIME_MS` is a fixed 12 hours from creation. There is no sliding
expiration: reading, authorizing, or using a session never extends
`expiresAt`. Timestamps are canonical `Date` values; the D1 adapter persists
UTC milliseconds and the HTTP layer formats ISO-8601.

## Operational states

Phase 14.2 keeps only the operational states needed for secure cleanup:

- `ACTIVE`
- `DELETING`

Expiration is derived from `expiresAt`, not stored as a third state.
RulesContext processing states (`building`, `conflicts`, `ready`, ...) are
deliberately out of scope and live in later phases.

## Deletion lifecycle

```text
authorize (analysisId + bearer token)
    ↓
atomic mark ACTIVe → DELETING (CAS/status-guarded update)
    ↓
AnalysisResourceCleanerPort.cleanup(analysisId)
    ↓
SessionRepositoryPort.delete(analysisId)
```

Deletion is retry-safe: a failed cleanup leaves a `DELETING` row that both
`deleteSession()` and the scheduled expiry cleanup retry. Replayed deletes are
idempotent.

## Scheduled cleanup

`runExpiryCleanup({ now, repository, cleaner, limit })` processes a bounded
batch of candidates:

```text
status = ACTIVE AND expires_at <= now
OR
status = DELETING AND updated_at is stale
```

Each candidate transitions, runs the cleaner, and deletes the row. A single
failure is isolated and does not corrupt other sessions.

## Exports

- `createAnalysisSession`, `authorizeSession`, `deleteSession`,
  `runExpiryCleanup`
- `SessionRepositoryPort`, `AnalysisResourceCleanerPort`, `SessionCrypto`,
  `Clock`
- `webCrypto` default implementation, base64url/hex/constant-time helpers
- domain types and constants

Tests use deterministic fakes; crypto correctness is covered against real Web
Crypto through `webCrypto`.
