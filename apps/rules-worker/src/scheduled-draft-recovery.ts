import {
  DRAFT_CLAIM_STALE_MS,
  recoverStaleDraftClaims,
} from "@repo/character-sheet-session";
import { MAX_CLEANUP_BATCH_SIZE } from "@repo/rules-analysis-session";
import type { AppDeps } from "./handler.js";

/**
 * Bounded stale draft-claim recovery for the existing fifteen-minute schedule.
 *
 * The R2 snapshot probe is a narrow adapter over the V2 store: a version
 * exists when the canonical store can read that exact immutable snapshot, and
 * historical V1 bytes count because the store canonicalizes V1 in memory
 * without rewriting them. When the V2 store binding is unavailable there is
 * nothing safe to probe, so recovery is skipped. Failures are logged and
 * isolated so the session-expiry cleanup always runs.
 */
export async function recoverStaleSheetDraftClaims(
  deps: Pick<AppDeps, "clock" | "sheetDraftHeadRepository"> & {
    sheetDraftStoreV2?: AppDeps["sheetDraftStoreV2"];
  },
): Promise<void> {
  const store = deps.sheetDraftStoreV2;
  if (store === undefined) {
    return;
  }
  try {
    const result = await recoverStaleDraftClaims(
      deps.sheetDraftHeadRepository,
      {
        hasSnapshot: async (identity, version) =>
          (await store.getDraftVersion(identity, version)) !== null,
      },
      deps.clock.now(),
      DRAFT_CLAIM_STALE_MS,
      MAX_CLEANUP_BATCH_SIZE,
    );
    if (result.failed.length > 0) {
      console.warn(
        `character-sheet stale-claim recovery: ${result.failed.length} draft(s) failed`,
      );
    }
  } catch (error) {
    console.warn(
      `character-sheet stale-claim recovery failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}
