import { DRAFT_CLAIM_STALE_MS } from "./draft-head.js";
import type { DraftHeadRepositoryPort } from "./draft-head-repository.js";

/**
 * Bounded R2-side probe used by stale-claim recovery. The R2 draft store is
 * the only authority on whether a snapshot actually exists; recovery never
 * assumes a version's existence from the D1 claim alone.
 */
export interface DraftSnapshotProbe {
  hasSnapshot(
    identity: { sessionId: string; draftId: string },
    version: number,
  ): Promise<boolean>;
}

export interface StaleClaimRecoveryResult {
  recovered: number;
  committed: number;
  released: number;
  failed: string[];
}

/**
 * Bounded recovery for claims that outlived `staleAfterMs`. The probe asks R2
 * (the draft authority) whether the pending snapshot actually exists:
 *
 * - snapshot absent  -> the crash happened after the claim but before the R2
 *   write; release the stale claim so a fresh claim can retry N -> N+1.
 * - snapshot present -> the R2 write landed but the D1 commit never did;
 *   complete the commit so version N+1 becomes authoritative. Ownership and
 *   state proof is the guarded D1 mutation itself: a `wrong_claim` or
 *   `version_conflict` outcome means another writer already resolved or
 *   superseded the claim, which is not an error.
 *
 * No snapshot is ever deleted here: a present snapshot may already be
 * committed, and deleting it would destroy the only authoritative copy.
 */
export async function recoverStaleDraftClaims(
  repository: DraftHeadRepositoryPort,
  probe: DraftSnapshotProbe,
  now: Date,
  staleAfterMs: number = DRAFT_CLAIM_STALE_MS,
  limit = 50,
): Promise<StaleClaimRecoveryResult> {
  const heads = await repository.findStalePending(now, staleAfterMs, limit);
  let committed = 0;
  let released = 0;
  const failed: string[] = [];
  for (const head of heads) {
    const identity = { sessionId: head.sessionId, draftId: head.draftId };
    const pendingVersion = head.pendingVersion;
    const claimId = head.pendingClaimId;
    if (pendingVersion === null || claimId === null) {
      continue;
    }
    try {
      const snapshotExists = await probe.hasSnapshot(identity, pendingVersion);
      if (snapshotExists) {
        const outcome = await repository.commit(
          identity,
          claimId,
          head.currentVersion,
          now,
        );
        if (outcome.kind === "committed") {
          committed += 1;
        }
      } else {
        const outcome = await repository.release(
          identity,
          claimId,
          pendingVersion,
          now,
        );
        if (outcome.kind === "released") {
          released += 1;
        }
      }
    } catch {
      failed.push(`${identity.sessionId}:${identity.draftId}`);
    }
  }
  return { recovered: committed + released, committed, released, failed };
}
