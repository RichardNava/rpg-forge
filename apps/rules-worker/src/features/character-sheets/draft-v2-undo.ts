/**
 * V2 undo orchestration for the live undo route (14.10).
 *
 * Composes the 4E3B1 runtime kernel with the V2 domain undo authority.
 *
 * Responsibilities:
 * - Read D1 head to check undo eligibility (undoSourceVersion, undoConsumed)
 * - Load undo source snapshot from R2
 * - Create new snapshot at version V+2 by copying undo source content
 * - Persist via normal machinery (which sets undoSourceVersion to current version)
 * - Mark undoConsumed = true in D1 head
 *
 * Layering:
 *
 * HTTP transport parsing          -> draft-v2-transport.ts
 * HTTP egress serialization       -> draft-v2-orchestration.ts
 * THIS MODULE                     = V2 undo orchestration
 *     +--> readCurrentDraftV2       (4E3B1 runtime kernel - reads head + snapshot)
 *     +--> getDraftVersion          (V2 store - loads undo source)
 *     +--> applyDraftMutationV2     (package domain - undo mutation)
 *     +--> persistNextDraftV2       (4E3B1 runtime kernel - persists V+2)
 *     +--> commit with undo metadata (D1 head update)
 *     v
 * Live HTTP handler               (character-sheet-handler.ts)
 */
import {
  applyDraftMutationV2,
  type CharacterSheetDraftV2,
  type DraftMutationV2,
  DraftUndoMutationV2Schema,
  draftError,
} from "@repo/character-sheet-draft";
import type { DraftHeadIdentity } from "@repo/character-sheet-session";
import type { DraftV2Runtime } from "./draft-v2-runtime.js";
import { readCurrentDraftV2, persistUndoDraftV2 } from "./draft-v2-runtime.js";

export type { DraftV2Runtime };

/**
 * Orchestrates a V2 undo end-to-end: check eligibility -> load undo source -> domain -> persist.
 *
 * Returns the resulting canonical V2 draft on success.
 * Returns `null` when no head or no current snapshot exists (established
 * missing-resource semantics; future HTTP handler maps to 404).
 * Propagates DraftError for all concurrency and domain failures.
 *
 * @param deps - Runtime dependencies (D1 head repo, V2 store, clock, crypto)
 * @param identity - Session/draft identity
 * @param expectedVersion - Client's expected version (mandatory, never inferred)
 * @returns The resulting V2 draft, or `null` if the draft/head does not exist
 * @throws DraftError - version_conflict, draft_confirmed, invalid_mutation, storage_unavailable, undo_not_available, undo_already_consumed, etc.
 */
export async function undoDraftV2(
  deps: DraftV2Runtime,
  identity: DraftHeadIdentity,
  expectedVersion: number,
): Promise<CharacterSheetDraftV2 | null> {
  // Read current state through the 4E3B1 kernel (includes version check)
  const state = await readCurrentDraftV2(deps, identity);
  if (state === null) {
    return null;
  }
  if (state.draft === null) {
    return null;
  }

  const current = state.draft;
  const head = state.head;

  // Check undo eligibility from D1 head metadata
  if (head.undoSourceVersion === null) {
    throw draftError("undo_not_available", "No undo source version available.");
  }
  if (head.undoConsumed) {
    throw draftError("undo_already_consumed", "The one-level Undo has already been consumed.");
  }

  // Load the undo source snapshot from R2
  const undoSource = await deps.store.getDraftVersion(identity, head.undoSourceVersion);
  if (undoSource === null) {
    throw draftError("undo_source_missing", "The undo source snapshot could not be loaded.");
  }

  // Create a draft with the undo source's CONTENT but the current version number.
  // The undo mutation will bump the version to current.version + 1.
  const restoredDraft: CharacterSheetDraftV2 = {
    ...undoSource,
    draftId: current.draftId,
    sessionId: current.sessionId,
    baseVersion: current.baseVersion,
    version: current.version, // Same as current; undo mutation will bump to V+1
    // Preserve the current mode, rulesContextId, source
    mode: current.mode,
    rulesContextId: current.rulesContextId,
    source: current.source,
    // characterName MUST mirror the restored values["character_name"]
    characterName: (undoSource.values["character_name"] as string) ?? null,
    // Confirmed must be false for an undo result
    confirmed: false,
  };

  // Apply the undo mutation which bumps version to current.version + 1
  const undoMutation = DraftUndoMutationV2Schema.parse({ op: "undo" });
  const finalDraft = applyDraftMutationV2(restoredDraft, undoMutation, restoredDraft.version);

  // Persist the restored draft through the normal machinery with Undo-specific metadata
  // This will advance the head from current.version to current.version + 1
  // and set undoConsumed = true atomically in the D1 head commit.
  return persistUndoDraftV2(deps, current, finalDraft);
}