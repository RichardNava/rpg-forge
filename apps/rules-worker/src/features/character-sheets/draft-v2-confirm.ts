/**
 * 4E3B3 — INTERNAL V2 confirm/finalize orchestration (not wired to any route).
 *
 * Composes the 4E3B1 runtime kernel with the V2 finalize domain authority.
 *
 * Responsibilities:
 * - Open current state via the 4E3B1 barrier (expectedVersion + pending check)
 * - Delegate to finalizeDraftV2
 * - Confirm ALWAYS produces N+1 with confirmed=true (no semantic no-op)
 * - Persist via persistNextDraftV2
 * - Return the confirmed next draft
 *
 * Layering:
 *
 * HTTP transport parsing          -> draft-v2-transport.ts
 * HTTP egress serialization       -> draft-v2-orchestration.ts
 * THIS MODULE                     = V2 confirm orchestration
 *     +--> openDraftV2Mutation      (4E3B1 runtime kernel)
 *     +--> finalizeDraftV2          (package domain)
 *     +--> persistNextDraftV2       (4E3B1 runtime kernel)
 *     v
 * Future HTTP handler             (not here)
 */
import {
  finalizeDraftV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type { DraftV2Runtime, DraftHeadIdentity } from "./draft-v2-runtime.js";
import { openDraftV2Mutation, persistNextDraftV2 } from "./draft-v2-runtime.js";

/**
 * Orchestrates a V2 confirm/finalize end-to-end: barrier -> domain -> persist.
 *
 * An ACCEPTED confirm ALWAYS produces N+1 with confirmed=true.
 * There is NO semantic no-op branch for confirm.
 * Confirming an already-confirmed draft is an idempotence error.
 *
 * Returns the confirmed V2 draft on success.
 * Returns `null` when no head or no current snapshot exists (established
 * missing-resource semantics; future HTTP handler maps to 404).
 * Propagates DraftError for all concurrency and domain failures.
 *
 * @param deps - Runtime dependencies (D1 head repo, V2 store, clock, crypto)
 * @param identity - Session/draft identity
 * @param expectedVersion - Client's expected version (mandatory, never inferred)
 * @returns The confirmed next draft, or `null` if missing
 * @throws DraftError - version_conflict, draft_inflight, draft_confirmed, etc.
 */
export async function confirmDraftV2(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  expectedVersion: number,
): Promise<CharacterSheetDraftV2 | null> {
  const state = await openDraftV2Mutation(deps, identity, expectedVersion);
  if (state === null) {
    return null;
  }
  if (state.draft === null) {
    return null;
  }

  const current = state.draft;
  const next = finalizeDraftV2(current);

  return persistNextDraftV2(deps, current, next);
}
