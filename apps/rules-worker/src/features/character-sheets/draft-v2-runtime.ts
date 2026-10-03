/**
 * 4E3B1 — INTERNAL V2 orchestration kernel: D1 concurrency barriers plus R2
 * persistence (not wired to any route).
 *
 * ## Scope
 *
 * Three separable responsibilities, deliberately NOT fused:
 *
 * 1. **Read current canonical V2 state** — D1 head → `currentVersion` → the V2
 *    store. Performs ZERO writes.
 * 2. **First concurrency barrier** — the client's `expectedVersion` compared to
 *    `D1 head.currentVersion`, plus pending-claim detection, both BEFORE any
 *    domain operation runs (frozen 4D contract §5 steps 2–6).
 * 3. **Second concurrency barrier** — persisting an ALREADY-PRODUCED `N+1`
 *    snapshot through the proven D1 claim → R2 put → D1 commit lifecycle.
 *
 * This module does NOT call `applyDraftMutationV2`, `rerollLockedDraftValuesV2`
 * or `finalizeDraftV2`. Those are 4E3B2/4E3B3. This slice only makes the kernel
 * they will sit on top of correct.
 *
 * ## Layering
 *
 * ```text
 * Live HTTP handler       (character-sheet-handler.ts)
 *     v
 * THIS MODULE             D1 + R2 orchestration core
 *     +--> DraftHeadRepositoryPort        (version coordination only)
 *     +--> CharacterSheetDraftStoreV2     (V2 snapshot bytes)
 *     +--> V2 domain                      [later slices, NOT here]
 *     v
 * draft-v2-orchestration.ts               (HTTP egress, prepared in 4E3A)
 * ```
 *
 * ## Deliberate exclusions
 *
 * - **No `CharacterSheetDraft | CharacterSheetDraftV2` union.** The V2 store is
 *   V2-only and stays V2-only; this module never names the V1 draft type.
 * - **No schemaVersion branching.** `parseCanonicalCharacterSheetDraft` inside
 *   the V2 store adapter is the single V1/V2 compatibility boundary. A stored V1
 *   snapshot becomes V2 there, in memory, and this module only ever sees V2.
 * - **No V1 store use.** `deps.store` is `CharacterSheetDraftStoreV2`.
 * - **No generic store.** Making the store generic to share code with V1 would
 *   force a partial cutover and let a canonical-V2 consumer receive V1.
 * - **No artificial error channel.** Every domain and persistence failure is a
 *   THROWN `DraftError`, exactly as in V2. There is no `DraftV2Outcome`, no
 *   `runDraftV2Operation`, no `{ kind: "ok" | "error" }`. This module sits BELOW
 *   the HTTP translation boundary; the future handler keeps using the private
 *   `draftErrorToResponse` in `character-sheet-handler.ts`.
 *
 * ## Version ownership
 *
 * The V2 domain owns version numbers. `persistNextDraftV2` persists a snapshot
 * whose version was ALREADY produced and NEVER creates, bumps or repairs a
 * version. It asserts continuity (`next.version === current.version + 1`) and
 * fails loudly rather than silently repairing it, because a mismatched snapshot
 * would make R2's derived key disagree with the version D1 commits — an
 * orphaned object plus a head pointing at a version that does not exist.
 *
 * ## Semantic no-op
 *
 * Read/current-state acquisition is deliberately separate from next-state
 * persistence so 4E3B2 can implement the frozen no-op bypass:
 *
 * ```ts
 * const next = applyDraftMutationV2(current.draft, mutation);
 * if (next.version === current.draft.version) return current.draft; // no persist
 * return persistNextDraftV2(deps, current.draft, next);
 * ```
 *
 * Nothing here claims merely because an operation returned. Persistence is an
 * explicit call, so a no-op never reaches a claim or an R2 write.
 */
import {
  draftError,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type {
  DraftHead,
  DraftHeadIdentity,
  DraftHeadRepositoryPort,
} from "@repo/character-sheet-session";
import type { Clock, SessionCrypto } from "@repo/rules-analysis-session";
import type { CharacterSheetDraftStoreV2 } from "@repo/character-sheet-draft";

export type { DraftHeadIdentity };

/**
 * The kernel's collaborators. Narrow and explicit rather than `AppDeps`, so it
 * can never reach a live V1 store, a route helper or an HTTP concern.
 *
 * `identity` is always `DraftHeadIdentity`, which is structurally the same
 * `{ sessionId, draftId }` pair the V2 store addresses snapshots by; the two
 * ports deliberately reuse one identity shape.
 */
export interface DraftV2Runtime {
  readonly heads: DraftHeadRepositoryPort;
  readonly store: CharacterSheetDraftStoreV2;
  readonly clock: Clock;
  readonly crypto: SessionCrypto;
}

/**
 * The committed head plus the canonical V2 snapshot it selects.
 *
 * `draft` is `null` when the head exists but its immutable snapshot does not.
 * Absence is a routing decision (`SHEET_DRAFT_NOT_FOUND`), NOT a storage
 * failure, so it is never an error here — this mirrors the established live V1
 * behavior, where a null read becomes a 404 rather than a 422/503.
 */
export interface DraftV2CurrentState {
  readonly head: DraftHead;
  readonly draft: CharacterSheetDraftV2 | null;
}

/**
 * FIRST CONCURRENCY BARRIER — the frozen precondition (4D contract §5 steps
 * 4–6), as a pure function over an already-loaded head.
 *
 * ORDER IS THE CONTRACT, and it is the deliberate 4E reorder: `expectedVersion`
 * is compared to `currentVersion` FIRST, so a stale client is rejected before
 * inflight detection. This is what makes the frozen table hold:
 *
 * ```text
 * current=7, pending=8, expected=6  ->  version_conflict   (stale wins)
 * current=7, pending=8, expected=7  ->  draft_inflight
 * current=7, pending=8, expected=8  ->  version_conflict
 * ```
 *
 * The third row is why `expectedVersion` must never be compared against
 * `pendingVersion`: 8 is a legitimate announcement of an uncommitted `N+1`, not
 * a current version, so accepting it would admit a client one version ahead.
 *
 * `expectedVersion` is NEVER inferred from D1, never defaulted, and never
 * optional. Callers pass the client's value verbatim.
 *
 * Staleness also precedes any confirmed-draft rejection: the confirmed guard
 * lives inside the V2 domain operations (4E3B2/3) and runs only after this
 * barrier has already admitted the request. There is deliberately NO
 * confirmed-state check here — this module must not become a second authority
 * for draft state.
 *
 * ## Pending-claim detection: any pending claim counts
 *
 * A pending claim is reported whenever `pendingVersion`/`pendingClaimId` is set,
 * regardless of `pendingSince` age. This is the established live V1 behavior and
 * it is also what the D1 CAS enforces anyway (`claim` requires
 * `pendingVersion IS NULL`), so a stale claim could not be written past even if
 * this check were relaxed. Stale claims are resolved out of band by the bounded
 * `recoverStaleDraftClaims` sweep; inlining that resolution here would duplicate
 * the compensation algorithm.
 */
export function assertDraftV2Precondition(
  head: DraftHead,
  expectedVersion: number,
): void {
  if (expectedVersion !== head.currentVersion) {
    throw draftError(
      "version_conflict",
      `Expected draft version ${expectedVersion} but the current version is ${head.currentVersion}.`,
    );
  }
  if (head.pendingVersion !== null || head.pendingClaimId !== null) {
    throw draftError(
      "draft_inflight",
      "Another save is already in progress for this draft.",
    );
  }
}

/**
 * READ the current canonical V2 state (no barrier; the GET path).
 *
 * The head's `currentVersion` is the snapshot selector, so the snapshot/head
 * consistency invariant (4D contract §9) holds by construction. The V2 store
 * adapter additionally verifies the stored payload's `sessionId`, `draftId` and
 * `version` against the requested identity and key, so those three cross-checks
 * are NOT duplicated here.
 *
 * Performs ZERO writes: no D1 claim, no R2 put, no version bump, and no rewrite
 * of a historical V1 snapshot. A stored V1 snapshot is canonicalized IN MEMORY by
 * the store adapter and returned as V2; the bytes on disk stay V1 until the next
 * state-changing snapshot stores V2 as a new version.
 *
 * Returns `null` when there is no head. Returns `{ head, draft: null }` when the
 * head exists but its snapshot does not.
 */
export async function readCurrentDraftV2(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
): Promise<DraftV2CurrentState | null> {
  const head = await deps.heads.getHead(identity);
  if (head === null) {
    return null;
  }
  const draft = await deps.store.getDraftVersion(identity, head.currentVersion);
  return { head, draft };
}

/**
 * FIRST BARRIER + READ, in the exact contract §5 order: load head → compare
 * `expectedVersion` → pending-claim check → read the snapshot.
 *
 * The barrier runs BEFORE the R2 read, so a stale client never causes a storage
 * round trip, and the snapshot is always selected by `head.currentVersion` —
 * never by `expectedVersion` and never by `pendingVersion`.
 *
 * The caller still owns the no-op decision and the domain call; this function
 * only hands it the verified current state.
 */
export async function openDraftV2Mutation(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  expectedVersion: number,
): Promise<DraftV2CurrentState | null> {
  const head = await deps.heads.getHead(identity);
  if (head === null) {
    return null;
  }
  assertDraftV2Precondition(head, expectedVersion);
  const draft = await deps.store.getDraftVersion(identity, head.currentVersion);
  return { head, draft };
}

/**
 * SECOND CONCURRENCY BARRIER — persist an ALREADY-PRODUCED `N+1` snapshot.
 *
 * ```text
 * stable head N
 *   -> atomic D1 claim N+1        (CAS: currentVersion = N AND pendingVersion IS NULL)
 *   -> R2 put canonical V2 N+1
 *   -> D1 commit N+1              (CAS: currentVersion = N AND pendingVersion = N+1 AND claimId)
 * ```
 *
 * The claim is what protects the window between the barrier and this write:
 * `expectedVersion` does NOT replace the D1 CAS, because another writer can
 * commit in between.
 *
 * `expectedVersion` is NEVER inferred, and this function never creates a
 * version. `next.version` was already produced by the V2 domain; this function
 * asserts it continues from `current` and persists exactly that snapshot.
 *
 * ## Failure semantics (identical to the proven live V1 lifecycle)
 *
 * - claim `already_pending`  → `draft_inflight`, no R2 write
 * - claim `version_conflict` → `version_conflict`, no R2 write
 * - claim `not_found`        → `version_conflict` (the head vanished after the
 *   caller read it, so the client's expected version is no longer current; V1
 *   already maps a mid-write `not_found` on COMMIT to `version_conflict`)
 * - R2 put failure           → best-effort release, then the store's own
 *   `DraftError` is rethrown unchanged (V1 discarded it and hard-coded a 503)
 * - commit failure           → best-effort release, then `version_conflict`
 *
 * A failed write never leaves a visible skipped version: the release clears the
 * pending claim so the next writer retries the same `N -> N+1`. Release is
 * best-effort and swallowed, because a residual claim is exactly what the bounded
 * `recoverStaleDraftClaims` sweep exists to reconcile.
 *
 * ## No-op bypass
 *
 * Callers MUST NOT route a no-op through this function. It has no `N -> N`
 * branch on purpose: teaching persistence that an unchanged version is a write
 * would create a version for nothing. The bypass belongs above, in 4E3B2.
 */
export async function persistNextDraftV2(
  deps: DraftV2Runtime,
  current: CharacterSheetDraftV2,
  next: CharacterSheetDraftV2,
): Promise<CharacterSheetDraftV2> {
  assertNextSnapshotContinues(current, next);

  const identity: DraftHeadIdentity = {
    sessionId: current.sessionId,
    draftId: current.draftId,
  };
  const claimId = deps.crypto.uuid();

  const claimed = await deps.heads.claim(
    identity,
    current.version,
    claimId,
    deps.clock.now(),
  );

  if (claimed.kind === "already_pending") {
    throw draftError(
      "draft_inflight",
      "Another save is already in progress for this draft.",
    );
  }
  if (claimed.kind === "version_conflict") {
    throw draftError(
      "version_conflict",
      "The draft version changed during the save.",
    );
  }
  if (claimed.kind === "not_found") {
    throw draftError(
      "version_conflict",
      "The draft version changed during the save.",
    );
  }

  try {
    await deps.store.putDraft(next);
  } catch (error) {
    await releaseClaimQuietly(deps, identity, claimId, claimed.claimedVersion);
    throw error;
  }

  const committed = await deps.heads.commit(
    identity,
    claimId,
    current.version,
    deps.clock.now(),
  );

  if (committed.kind !== "committed") {
    // The R2 snapshot landed but D1 did not accept ownership. Release so the next
    // writer can retry the same N -> N+1 rather than deadlocking on our claim.
    await releaseClaimQuietly(deps, identity, claimId, claimed.claimedVersion);
    throw draftError(
      "version_conflict",
      "The draft version changed during the save.",
    );
  }

  return next;
}

/**
 * Fails loudly when `next` is not the real successor of `current`.
 *
 * This is a defensive invariant, not a repair step: `next.version` is never
 * incremented and `current.version` is never reused. A non-conforming snapshot is
 * rejected BEFORE the claim, because persisting it would write an R2 object under
 * a key D1 never announces — an orphaned version plus a head whose
 * `currentVersion` has no snapshot, which reads back as `SHEET_DRAFT_NOT_FOUND`.
 *
 * Identity continuity is asserted for the same reason: the R2 key is derived from
 * the snapshot's OWN `sessionId`/`draftId`, so a mismatched next draft would be
 * filed under a prefix this head never reads. This is NOT a duplicate of the
 * store's payload/key check — the store verifies payload against its own derived
 * key; this verifies the payload against the head being advanced.
 *
 * `invalid_draft` is the established code for "this value is not a valid draft".
 * In correct operation this never fires: the V2 domain is the sole producer of
 * `N+1` snapshots. Mapping it to a client status is the future handler's decision
 * (4E3B2/3), not this module's.
 */
function assertNextSnapshotContinues(
  current: CharacterSheetDraftV2,
  next: CharacterSheetDraftV2,
): void {
  if (
    next.sessionId !== current.sessionId ||
    next.draftId !== current.draftId ||
    next.baseVersion !== current.baseVersion
  ) {
    throw draftError(
      "invalid_draft",
      "The next draft does not belong to the draft being saved.",
    );
  }
  if (next.version !== current.version + 1) {
    throw draftError(
      "invalid_draft",
      `The next draft version must be ${current.version + 1} but is ${next.version}.`,
    );
  }
}

/**
 * Best-effort claim compensation. A failure here is deliberately swallowed: the
 * claim is already released by a successful call, and a residual claim is what
 * the bounded `recoverStaleDraftClaims` sweep reconciles.
 */
async function releaseClaimQuietly(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  claimId: string,
  claimedVersion: number,
): Promise<void> {
  try {
    await deps.heads.release(
      identity,
      claimId,
      claimedVersion,
      deps.clock.now(),
    );
  } catch {
    // Best-effort compensation; stale-claim recovery covers residual claims.
  }
}
