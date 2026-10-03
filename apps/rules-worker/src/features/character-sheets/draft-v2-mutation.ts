/**
 * V2 mutation orchestration for the live mutate route.
 *
 * Composes the 4E3B1 runtime kernel with the V2 domain mutation authority.
 *
 * Responsibilities:
 * - Open current state via the 4E3B1 barrier (expectedVersion + pending check)
 * - Delegate to applyDraftMutationV2 for all 11 mutation operations
 * - Handle semantic no-op by returning current without persistence
 * - Persist real mutations (N -> N+1) via persistNextDraftV2
 * - Propagate DraftError unchanged (version_conflict, draft_confirmed, etc.)
 *
 * Layering:
 *
 * HTTP transport parsing          -> draft-v2-transport.ts
 * HTTP egress serialization       -> draft-v2-orchestration.ts
 * THIS MODULE                     = V2 mutation orchestration
 *     +--> openDraftV2Mutation      (4E3B1 runtime kernel)
 *     +--> applyDraftMutationV2     (package domain)
 *     +--> persistNextDraftV2       (4E3B1 runtime kernel)
 *     v
 * Live HTTP handler               (character-sheet-handler.ts)
 */
import {
  applyDraftMutationV2,
  type CharacterSheetDraftV2,
  type DraftMutationV2,
} from "@repo/character-sheet-draft";
import type { DraftHeadIdentity } from "@repo/character-sheet-session";
import type { DraftV2Runtime } from "./draft-v2-runtime.js";
import { openDraftV2Mutation, persistNextDraftV2 } from "./draft-v2-runtime.js";

export type { DraftV2Runtime };

/**
 * Orchestrates a V2 mutation end-to-end: barrier -> domain -> (no-op | persist).
 *
 * Returns the resulting canonical V2 draft on success.
 * Returns `null` when no head or no current snapshot exists (established
 * missing-resource semantics; future HTTP handler maps to 404).
 * Propagates DraftError for all concurrency and domain failures.
 *
 * @param deps - Runtime dependencies (D1 head repo, V2 store, clock, crypto)
 * @param identity - Session/draft identity
 * @param expectedVersion - Client's expected version (mandatory, never inferred)
 * @param mutation - Validated V2 mutation command
 * @returns The resulting V2 draft, or `null` if the draft/head does not exist
 * @throws DraftError - version_conflict, draft_inflight, draft_confirmed, invalid_mutation, storage_unavailable, etc.
 */
export async function mutateDraftV2(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  expectedVersion: number,
  mutation: DraftMutationV2,
): Promise<CharacterSheetDraftV2 | null> {
  const state = await openDraftV2Mutation(deps, identity, expectedVersion);
  if (state === null) {
    return null;
  }
  if (state.draft === null) {
    return null;
  }

  const current = state.draft;
  const next = applyDraftMutationV2(current, mutation, expectedVersion);

  if (next.version === current.version) {
    return next;
  }

  return persistNextDraftV2(deps, current, next);
}
