/**
 * Bounded lifetime for an in-flight draft-version claim. A claim must resolve
 * (commit or release) within this window; a head whose claim outlives it is a
 * stale-claim recovery candidate. Claims are synchronous fast-path mutations,
 * so one minute is an extremely generous bound.
 */
export const DRAFT_CLAIM_STALE_MS = 60 * 1000;

export interface DraftHeadIdentity {
  sessionId: string;
  draftId: string;
}

/**
 * D1 draft-head operational metadata for exact-version draft mutation
 * coordination. It stores ZERO draft content: no labels, no field values, no
 * sections, no template JSON, no seed payload. The immutable R2 snapshot
 * remains the source of truth for the draft body. `currentVersion` is the last
 * committed version; a pending claim announces `currentVersion + 1` before its
 * R2 snapshot has been written, so readers can never observe a version that
 * does not exist yet.
 */
export interface DraftHead {
  sessionId: string;
  draftId: string;
  currentVersion: number;
  pendingVersion: number | null;
  pendingClaimId: string | null;
  pendingSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The last committed version, without leaking pending-claim state. */
export interface DraftHeadStableView {
  sessionId: string;
  draftId: string;
  currentVersion: number;
}

export function toDraftHeadStableView(head: DraftHead): DraftHeadStableView {
  return {
    sessionId: head.sessionId,
    draftId: head.draftId,
    currentVersion: head.currentVersion,
  };
}

export function isDraftHeadStable(head: DraftHead): boolean {
  return (
    head.pendingVersion === null &&
    head.pendingClaimId === null &&
    head.pendingSince === null
  );
}

/** Boundary-inclusive: a claim at exactly the stale cutoff is stale. */
export function isStaleDraftClaim(head: DraftHead, now: Date): boolean {
  return (
    head.pendingSince !== null &&
    now.getTime() - head.pendingSince.getTime() >= DRAFT_CLAIM_STALE_MS
  );
}

export type CreateDraftHeadResult =
  | { kind: "created"; head: DraftHead }
  | { kind: "already_exists"; head: DraftHead };

/**
 * A claim is the atomic "N -> N+1" reservation. Exactly one request wins; the
 * loser receives a deterministic concurrency outcome (`already_pending` when a
 * claim is live, `version_conflict` when the expected version is stale).
 */
export type DraftHeadClaimResult =
  | { kind: "claimed"; head: DraftHead; claimedVersion: number }
  | { kind: "already_pending"; head: DraftHead }
  | { kind: "version_conflict"; head: DraftHead | null }
  | { kind: "not_found" };

export type DraftHeadCommitResult =
  | { kind: "committed"; head: DraftHead }
  | { kind: "wrong_claim"; head: DraftHead | null }
  | { kind: "version_conflict"; head: DraftHead | null }
  | { kind: "not_found" };

export type DraftHeadReleaseResult =
  | { kind: "released"; head: DraftHead }
  | { kind: "wrong_claim"; head: DraftHead | null }
  | { kind: "not_found" };
