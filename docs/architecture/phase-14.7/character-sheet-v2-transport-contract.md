# Character-Sheet V2 Transport Contract

**Status:** FROZEN FOR 4E CUTOVER
**Date:** 2026-09-29
**Authority scope:** V2 character-sheet HTTP transport, concurrency, and error behavior.
**Product behavior authority remains:** `docs/features/character-sheets.md` (ACTIVE)
**Phase status labels:** CURRENT / COMPLETED / SUPERSEDED / DEFERRED

## Purpose

Milestone 4D freezes the HTTP transport contract for V2 character-sheet drafts.
Milestone 4A–4C built the V2 domain (editing, lifecycle, structural read model
and projection) and 4D1 defined the canonical transport payload schemas.
4D2 audited the current Worker/Web/D1/R2 orchestration against them and resolved
every ambiguity in advance of runtime work.

This document records the **resulting contract that 4E must implement**. It is
not a description of implemented runtime behavior. As of this document:

- The V2 domain and the V2 transport payload schemas are **IMPLEMENTED** and
  public through `@repo/character-sheet-draft`.
- The V2 **HTTP runtime is NOT implemented**. The rules-worker routes, the Web
  API client, the Web store, the R2 draft store, the extraction producer and the
  preview/export wiring all remain **V1**.

Nothing in this document may be read as a claim that V2 already serves traffic.

For current product behavior see `docs/features/character-sheets.md` (ACTIVE).
For the delivered 14.7 architecture see
`docs/architecture/phase-14.7/character-sheet-integration.md`.

## 1. Three independent version namespaces

These are three separate concerns and are deliberately never conflated. A V2
draft cutover changes **only** namespace B.

| #   | Namespace             | Current value                                                  | Changes during 4E?      |
| --- | --------------------- | -------------------------------------------------------------- | ----------------------- |
| A   | HTTP route version    | `/v1/character-sheets/...`                                     | **NO**                  |
| B   | Draft schema version  | `CharacterSheetDraft.schemaVersion` — `"1"` or canonical `"2"` | **YES** — becomes `"2"` |
| C   | R2 key-layout version | `temp/character-sheets/v1/...`                                 | **NO**                  |

- **A** is the API/storage-layout route prefix. 4E keeps it: changing it would
  be a breaking API change with no V2 benefit.
- **C** is the bucket key layout. The per-version segment is `v<version>.json`,
  where `<version>` is the _draft version_, not the schema version, so V2
  snapshots land under the existing prefix. Renaming it would break historical
  V1 objects and the 14.7B session sweep.
- **B** is the only namespace that moves, and only because the draft body
  changes shape.

## 2. Public V2 surface

The complete public V2 flow is reachable through the `@repo/character-sheet-draft`
package root alone:

| Stage   | Public API                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------- |
| READ    | `parseCanonicalCharacterSheetDraft`, `buildDraftStructuralReadModelV2`, `projectDraftV2ToSpec`     |
| CREATE  | `SheetDraftCreateRequestV2Schema`, `initialDraftVersionV2`                                         |
| EDIT    | `SheetDraftMutationRequestV2Schema`, `parseDraftMutationV2`, `applyDraftMutationV2`                |
| REROLL  | `SheetDraftRerollRequestV2Schema`, `rerollLockedDraftValuesV2`, `SheetDraftRerollResponseV2Schema` |
| CONFIRM | `SheetDraftConfirmRequestV2Schema`, `finalizeDraftV2`                                              |
| RESPOND | `SheetDraftSnapshotResponseV2Schema`                                                               |

There is deliberately **no facade object** — explicit schemas and functions
remain the contract.

`DraftExpectedVersionSchema` and `RerolledDraftKeySchema` are module-local
implementation detail and are **not** public: a consumer never needs either,
because both are already enforced by the exported schemas.

## 3. Request and response matrix

| Route                           | Request body                    | `expectedVersion` | Success response                      | Status |
| ------------------------------- | ------------------------------- | ----------------- | ------------------------------------- | ------ |
| `POST .../drafts`               | `CharacterSheetDraftV2`         | **NO**            | raw `CharacterSheetDraftV2`           | 201    |
| `GET .../drafts/{id}`           | none                            | n/a               | raw canonical `CharacterSheetDraftV2` | 200    |
| `GET .../drafts/{id}?version=N` | none                            | n/a               | raw canonical `CharacterSheetDraftV2` | 200    |
| `PATCH .../drafts/{id}`         | `{ expectedVersion, mutation }` | **YES**           | raw `CharacterSheetDraftV2`           | 200    |
| `POST .../drafts/{id}/reroll`   | `{ expectedVersion, seed }`     | **YES**           | `{ draft, rerolledKeys }`             | 200    |
| `POST .../drafts/{id}/confirm`  | `{ expectedVersion }`           | **YES**           | raw `CharacterSheetDraftV2`           | 200    |

Every state-changing operation after creation carries an explicit precondition,
not just edits. Without one, a stale client still viewing v7 could request a
reroll or a confirmation after the server advanced to v8, and the action would
silently apply to v8.

Create has no `expectedVersion`: there is no prior version to race against.

**Reroll is the only wrapped draft response**, because it additionally reports
which keys it rerolled. Create, get, mutate and confirm return the raw snapshot
with no operation-specific wrapper.

**Confirm returns a raw snapshot. There is no `{ draft: ... }` envelope.** See
§12 for the pre-existing mismatch this resolves.

`expectedVersion` stays **outside** `DraftMutationV2`: the concurrency
precondition is a transport concern, the mutation is the domain command.

## 4. Two concurrency barriers

V2 uses **two complementary barriers**. Neither replaces the other.

### Barrier 1 — client precondition (transport)

```
expectedVersion === D1 head.currentVersion
```

`expectedVersion` is "the version the caller believes is current". This
represents the state the user was actually looking at, and it protects user
intent from stale local state. It is checked by the Worker before the domain
operation runs.

### Barrier 2 — D1 atomic claim / CAS (persistence)

After the domain operation, D1 `claim(identity, currentVersion, claimId, now)`
atomically reserves `N → N+1` with a conditional `UPDATE ... WHERE
currentVersion = ? AND pendingVersion IS NULL`.

This protects races that occur **after** the precondition check and snapshot
read. Between those steps another writer can commit, so the claim is still
required. `expectedVersion` does **not** replace the D1 CAS.

### Authoritative version

`D1 DraftHead.currentVersion` is the authoritative committed version for the
precondition. It is **never** compared against:

- `pendingVersion` (the announced `currentVersion + 1`, not yet committed);
- a requested historical version;
- `baseVersion`;
- the latest R2 listing (a listing can contain orphaned snapshots from a lost
  D1 commit);
- a client-provided `draft.version`.

## 5. Precondition order

For an authenticated state-changing request:

1. Parse the strict V2 request envelope.
2. Load the D1 draft head.
3. Missing head → `SHEET_DRAFT_NOT_FOUND`.
4. Compare `expectedVersion` to `head.currentVersion`.
5. Mismatch → `SHEET_DRAFT_VERSION_CONFLICT`.
6. Matching **and** a live pending claim exists → `SHEET_DRAFT_INFLIGHT`.
7. Read the `head.currentVersion` snapshot.
8. Canonicalize the stored V1/V2 snapshot to `CharacterSheetDraftV2`.
9. Verify snapshot/head/path consistency (§9).
10. Parse and apply the domain operation.
11. No-op path, or the claim/write/commit path.

Steps 4–6 run **before** the domain operation. The current V1 orchestration only
inspects the pending claim after the domain call, so 4E reorders this.

### Pending-claim precedence

| `currentVersion` | `pendingVersion` | `expectedVersion` | Outcome                        |
| ---------------- | ---------------- | ----------------- | ------------------------------ |
| 7                | 8                | 6                 | `SHEET_DRAFT_VERSION_CONFLICT` |
| 7                | 8                | 7                 | `SHEET_DRAFT_INFLIGHT`         |
| 7                | 8                | 8                 | `SHEET_DRAFT_VERSION_CONFLICT` |

`expectedVersion` is **never** compared to `pendingVersion`. The third row is
the reason: `8` is a legitimate pending announcement, not a current version, and
comparing against it would wrongly admit a request that is one version ahead.

## 6. Stale versus confirmed

Staleness wins over the confirmed guard, uniformly across mutation, reroll and
confirm:

- stale `expectedVersion` → `SHEET_DRAFT_VERSION_CONFLICT`
- matching `expectedVersion` + confirmed → `SHEET_DRAFT_CONFIRMED`

This follows the already-approved V2 mutation precedence, where the version
precondition is evaluated before the confirmed guard in every mutation family.
Reroll and confirm have no domain-level `expectedVersion`, so they rely on the
Worker precondition (§5 step 4) firing before the domain function is invoked.

## 7. Version policies

### Real mutation

For `current = N`, `applyDraftMutationV2` produces exactly `N + 1` with
`baseVersion` unchanged. The Worker commits **that** snapshot.

The Worker **MUST NOT** call `bumpDraftVersion` or `bumpDraftVersionV2` after a
V2 mutation. The domain already bumped; a second bump would produce `N + 2`.

### Semantic no-op

Several approved V2 mutations return the **exact input snapshot** without
bumping — for example a `set_value` to the current value, a repeated
`set_field_label`, a lock/unlock of an already-correctly-locked Field, an
unchanged Section title, and some structural `place_node` no-ops.

When `result.version === current.version`, the Worker MUST:

- return HTTP 200 with the current canonical V2 snapshot;
- perform **no** D1 claim;
- perform **no** R2 write;
- create **no** new version.

A semantic no-op must remain a true no-op. Creating an immutable R2 version for
it would be wrong: the snapshot is unchanged, and the no-op detection is exact
(the domain returns the identical object reference).

This differs from the current V1 orchestration, which always bumps after
`applyDraftMutation`.

### Reroll

```
precondition matches
  → rerollLockedDraftValuesV2(draft, seed)
  → ALWAYS N+1 when accepted
  → D1 claim
  → R2 put the V2 N+1 snapshot
  → commit
  → { draft, rerolledKeys }
```

An accepted reroll **always** produces `N+1`, even when zero Fields are eligible
(no Field has a draw grammar) or the drawn value happened to equal the previous
one. Reroll is an explicit lifecycle action, so it has **no** no-op bypass. The
Worker **MUST NOT** bump after the domain reroll.

### Confirm

```
precondition matches
  → finalizeDraftV2(draft)
  → N+1 confirmed
  → claim / write / commit
  → raw CharacterSheetDraftV2 response
```

There is no empty request body, no `{ draft: ... }` response wrapper, and no
Worker bump. `finalizeDraftV2` takes no `expectedVersion`: it is a pure domain
transition, and concurrency belongs to the Worker/head-commit boundary.

Confirming an already-confirmed draft is an idempotence **error**
(`SHEET_DRAFT_CONFIRMED`), not a silent no-op and not a further version.

## 8. Create and read

### Create

- body validates as canonical V2;
- `sessionId` must match the authorized session;
- `version` must equal 1;
- no `expectedVersion`;
- existing-head duplicate behavior retained (`SHEET_DRAFT_ALREADY_EXISTS`);
- immutable R2 snapshot written, then the D1 head created;
- success is the raw V2 snapshot.

The transport schema deliberately does **not** assert `version === 1`; that is
Worker create policy, not payload shape. No new `confirmed: false` rule is
introduced — none is currently authoritative.

### GET

- **GET current:** D1 stable/current head → read the immutable snapshot →
  canonicalize V1/V2 in memory → raw V2 response.
- **GET `?version=N`:** read the exact immutable version `N` → canonicalize in
  memory → raw V2 response. A historical GET must **not** substitute the current
  head snapshot.

## 9. Snapshot / head consistency

After reading the committed snapshot, the expected invariant is:

```
snapshot.sessionId === authorized session
snapshot.draftId   === URL/path draft id
snapshot.version   === D1 head.currentVersion   (for current-state operations)
snapshot.version   === requested version         (for exact historical GET)
```

A mismatch is **stored corruption**, not a client concurrency conflict:

```
SHEET_DRAFT_CORRUPT / HTTP 500
```

It is explicitly **not** `SHEET_DRAFT_VERSION_CONFLICT`; reporting a corruption
as a conflict would invite the client to retry indefinitely against data that can
never succeed.

**Current gap (4E owns the cutover):** the V1 R2 adapter validates the payload
against the draft schema but performs **none** of the three cross-checks above,
and the handlers only test for a null read. 4E adds the assertions after
canonicalization.

## 10. Historical persistence policy

```
READ:                  stored V1 and V2 accepted
IN-MEMORY DOMAIN:      V2 only
NEXT STATE-CHANGING:   V2 only
HTTP RESPONSE:         V2 only
```

Transport responses are **V2 only**, and there is deliberately **no V1|V2
response union**. The canonical parser owns compatibility; transport never sees
V1. A raw V1 snapshot presented directly to a response schema is rejected.

Canonicalization **preserves the stored version**, so reading history is
read-only. Historical V1 bytes are **never rewritten** merely because they were
read. The next state-changing operation is what produces the first V2 snapshot.

A valid resulting history therefore looks like:

```
v1  schemaVersion "1"
v2  schemaVersion "1"
v3  schemaVersion "2"
v4  schemaVersion "2"
```

## 11. Error taxonomy

| Condition                                             | Transport code                      | HTTP |
| ----------------------------------------------------- | ----------------------------------- | ---- |
| Malformed V2 request envelope                         | `INVALID_REQUEST`                   | 400  |
| `DraftError("version_conflict")`                      | `SHEET_DRAFT_VERSION_CONFLICT`      | 409  |
| `DraftError("draft_inflight")`                        | `SHEET_DRAFT_INFLIGHT`              | 409  |
| `DraftError("draft_confirmed")`                       | `SHEET_DRAFT_CONFIRMED`             | 409  |
| `DraftError("field_read_locked")`                     | `SHEET_DRAFT_FIELD_READ_LOCKED`     | 422  |
| `DraftError("surface_out_of_bounds")`                 | `SHEET_DRAFT_SURFACE_OUT_OF_BOUNDS` | 422  |
| `DraftError("invalid_mutation")`                      | `SHEET_DRAFT_MUTATION_INVALID`      | 422  |
| Missing draft or head                                 | `SHEET_DRAFT_NOT_FOUND`             | 404  |
| Stored corruption / identity or version inconsistency | `SHEET_DRAFT_CORRUPT`               | 500  |
| Storage unavailable                                   | `SHEET_DRAFT_STORAGE_UNAVAILABLE`   | 503  |
| Live claim already exists, client version matching    | `SHEET_DRAFT_INFLIGHT`              | 409  |
| Lost D1 version race                                  | `SHEET_DRAFT_VERSION_CONFLICT`      | 409  |

### Envelope validation versus domain validation

A malformed **request envelope** is a 400: missing or mistyped
`expectedVersion`, an unknown top-level key, a malformed reroll/confirm
envelope, or an unknown mutation `op`. `DraftMutationV2` is a discriminated
union of strict objects, so an unmatched discriminant cannot survive envelope
parsing.

Once the envelope is structurally valid, the Worker **must still call
`parseDraftMutationV2(request.mutation)`**, because the unified schema does not
own every family-level semantic rule — notably `add_field`'s full
`DraftFieldSchema` validation. That failure is
`SHEET_DRAFT_MUTATION_INVALID` / 422, not 400.

### 4E REQUIRED CHANGE — `version_conflict` mapping gap

The current rules-worker `draftErrorToResponse(...)` does **not** explicitly map
`version_conflict`, and therefore falls through to:

```
SHEET_DRAFT_MUTATION_INVALID / 422
```

This is safe **only** because the current V1 runtime cannot produce that domain
error — V1 always bumps the version internally, so the version precondition
never fires. 4E activates exactly that path, so the mapping must be added
**before** any V2 route becomes reachable:

```
version_conflict → SHEET_DRAFT_VERSION_CONFLICT / 409
```

Without it, every stale-write rejection would report "your mutation is invalid"
instead of "retry against the current version". The same fallthrough also
mis-reports `invalid_draft`, `corrupt_draft`, `storage_unavailable`,
`invalid_draft_identity`, `cleanup_failed`, `projection_invalid` and
`writeback_invalid`; 4E should add explicit cases for all of them.

## 12. Pre-existing V1 integration mismatch — 4E resolution

**Recorded as a pre-existing mismatch. Not fixed in 4D3.**

| Layer                               | Current behavior                                              |
| ----------------------------------- | ------------------------------------------------------------- |
| Worker `handleConfirmDraft`         | returns `{ draft: CharacterSheetDraft }`                      |
| Web `SheetApiClient.confirmDraft()` | parses the response directly with `CharacterSheetDraftSchema` |
| Same-origin proxy                   | does not transform the body                                   |

`CharacterSheetDraftSchema` is a strict object, so a `{ draft: ... }` payload
fails on both the unknown `draft` key and every missing required key. The
mismatch is live: the proxy forwards the upstream body byte-for-byte with the
status preserved and performs no draft transformation, and no Worker route test
pins the confirm response shape, so neither side is verified against the other.

The frozen V2 contract resolves this by standardizing on a **raw
`CharacterSheetDraftV2`** response (§3).

## 13. D1 claim race outcomes

D1 remains the authoritative race barrier after the precondition, read and
domain evaluation. Frozen outcomes:

| Claim / commit result             | Transport                                                         |
| --------------------------------- | ----------------------------------------------------------------- |
| `already_pending`                 | `SHEET_DRAFT_INFLIGHT` / 409                                      |
| `version_conflict`                | `SHEET_DRAFT_VERSION_CONFLICT` / 409                              |
| `not_found`                       | `SHEET_DRAFT_NOT_FOUND` / 404                                     |
| commit wrong ownership or version | `SHEET_DRAFT_VERSION_CONFLICT` / 409                              |
| R2 write failure                  | release best-effort, then `SHEET_DRAFT_STORAGE_UNAVAILABLE` / 503 |

Existing best-effort compensation (release the claim on failure) must not be
weakened.

## 14. Proxy

Verified current behavior of the same-origin proxy:

- it whitelists methods and routes;
- it forwards `authorization` and `content-type`;
- it forwards the request body **without** semantic parsing;
- it forwards the upstream response status and body **without** draft
  transformation.

Therefore **no V2 payload reshape is required in the proxy**, and the existing
route whitelist remains usable. Bodies reach the Worker unchanged.

## 15. Web cutover delta (4E)

| Method         | From                | To                              |
| -------------- | ------------------- | ------------------------------- |
| `mutateDraft`  | raw `DraftMutation` | `{ expectedVersion, mutation }` |
| `rerollDraft`  | `{ seed }`          | `{ expectedVersion, seed }`     |
| `confirmDraft` | no payload          | `{ expectedVersion }`           |

Returned drafts become `CharacterSheetDraftV2`; the reroll result becomes
`SheetDraftRerollResponseV2`, whose `rerolledKeys` must use the canonical draft
key grammar rather than a bare non-empty string.

`expectedVersion` source: **the version of the locally-authoritative snapshot
being acted upon**. There is deliberately no independent client concurrency
counter. The current store optimistically advances its draft before the request,
so the store must capture the pre-mutation version as the precondition.

## 16. What 4D explicitly does NOT implement

Milestone 4D does not implement, and 4E owns:

- Worker V2 handlers;
- the Web V2 client and store;
- R2 canonical read/write;
- the extraction V2 producer;
- the blank/example V2 producer;
- preview/sidebar V2 wiring;
- PDF export V2 wiring.

Every V1 runtime consumer remains untouched and continues to serve V1 after this
milestone.
