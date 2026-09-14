import type {
  CreateDraftHeadResult,
  DraftHead,
  DraftHeadClaimResult,
  DraftHeadCommitResult,
  DraftHeadIdentity,
  DraftHeadReleaseResult,
  DraftHeadStableView,
} from "./draft-head.js";

/**
 * Narrow persistence contract for D1 draft-head coordination rows. Exact
 * version concurrency is real conditional SQL, never application-memory CAS:
 * claim/commit/release UPDATE only when the guarded row state still matches,
 * and the affected-row count decides the outcome. No generic SQL is exposed.
 */
export interface DraftHeadRepositoryPort {
  create(identity: DraftHeadIdentity): Promise<CreateDraftHeadResult>;
  getHead(identity: DraftHeadIdentity): Promise<DraftHead | null>;
  getStable(identity: DraftHeadIdentity): Promise<DraftHeadStableView | null>;
  claim(
    identity: DraftHeadIdentity,
    expectedVersion: number,
    claimId: string,
    claimsAt: Date,
  ): Promise<DraftHeadClaimResult>;
  commit(
    identity: DraftHeadIdentity,
    claimId: string,
    expectedCurrentVersion: number,
    committedAt: Date,
  ): Promise<DraftHeadCommitResult>;
  release(
    identity: DraftHeadIdentity,
    claimId: string,
    versionToRelease: number,
    releasedAt: Date,
  ): Promise<DraftHeadReleaseResult>;
  findStalePending(
    now: Date,
    staleAfterMs: number,
    limit: number,
  ): Promise<DraftHead[]>;
  deleteSessionHeads(sessionId: string): Promise<void>;
}
