/**
 * 4E3B3 — INTERNAL V2 reroll orchestration (not wired to any route).
 *
 * Composes the 4E3B1 runtime kernel with the V2 reroll domain authority.
 *
 * Responsibilities:
 * - Open current state via the 4E3B1 barrier (expectedVersion + pending check)
 * - Delegate to rerollLockedDraftValuesV2
 * - Reroll ALWAYS produces N+1 (no semantic no-op)
 * - Persist via persistNextDraftV2
 * - Return { draft, rerolledKeys }
 *
 * Layering:
 *
 * HTTP transport parsing          -> draft-v2-transport.ts
 * HTTP egress serialization       -> draft-v2-orchestration.ts
 * THIS MODULE                     = V2 reroll orchestration
 *     +--> openDraftV2Mutation      (4E3B1 runtime kernel)
 *     +--> rerollLockedDraftValuesV2 (package domain)
 *     +--> persistNextDraftV2       (4E3B1 runtime kernel)
 *     v
 * Future HTTP handler             (not here)
 */
import {
  rerollLockedDraftValuesV2,
  type DraftRerollResultV2,
} from "@repo/character-sheet-draft";
import type { DraftV2Runtime, DraftHeadIdentity } from "./draft-v2-runtime.js";
import { openDraftV2Mutation, persistNextDraftV2 } from "./draft-v2-runtime.js";

/**
 * Orchestrates a V2 reroll end-to-end: barrier -> domain -> persist.
 *
 * An ACCEPTED reroll ALWAYS produces N+1 and MUST be persisted.
 * There is NO semantic no-op branch for reroll.
 *
 * Returns the domain result { draft, rerolledKeys } on success.
 * Returns `null` when no head or no current snapshot exists (established
 * missing-resource semantics; future HTTP handler maps to 404).
 * Propagates DraftError for all concurrency and domain failures.
 *
 * @param deps - Runtime dependencies (D1 head repo, V2 store, clock, crypto)
 * @param identity - Session/draft identity
 * @param expectedVersion - Client's expected version (mandatory, never inferred)
 * @param seed - Reroll seed
 * @returns The committed next draft plus rerolled keys, or `null` if missing
 * @throws DraftError - version_conflict, draft_inflight, draft_confirmed, etc.
 */
export async function rerollDraftV2(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  expectedVersion: number,
  seed: string,
): Promise<DraftRerollResultV2 | null> {
  const state = await openDraftV2Mutation(deps, identity, expectedVersion);
  if (state === null) {
    return null;
  }
  if (state.draft === null) {
    return null;
  }

  const current = state.draft;
  const result = rerollLockedDraftValuesV2(current, seed);

  const committed = await persistNextDraftV2(deps, current, result.draft);

  return { draft: committed, rerolledKeys: result.rerolledKeys };
}
