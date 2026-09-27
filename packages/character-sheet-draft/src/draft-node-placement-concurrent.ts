import { type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { applyDraftNodePlacementV2 } from "./draft-node-placement-versioned";
import { validateDraftV2 } from "./draft-schema-v2";
import { draftError } from "./errors";
import { type DraftNodeDestination } from "./draft-structure-placement-plan";

/**
 * Optimistic concurrency wrapper for structural node placement.
 *
 * Preconditions:
 * - expectedVersion must exactly equal draft.version
 *
 * If versions match: delegates entirely to 2B1's applyDraftNodePlacementV2
 * If versions mismatch: rejects with version_conflict BEFORE any structural evaluation
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param nodeKey - The key of the node (Field or Section) to move
 * @param destination - Where to place the node (before/after/inside)
 * @param expectedVersion - The version the client expects the draft to be at
 * @returns A new validated V2 draft (version bumped by 2B1 if real change)
 */
export function applyDraftNodePlacementWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  nodeKey: string,
  destination: DraftNodeDestination,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  // 1. EXPECTED VERSION PRECONDITION - evaluated FIRST
  if (expectedVersion !== draft.version) {
    throw draftError(
      "version_conflict",
      `Expected version ${expectedVersion} but draft is at version ${draft.version}.`,
    );
  }

  // 2. DELEGATE TO APPROVED 2B1
  // All structural semantics, version bumping, no-op handling, confirmed/depth/invalid guards
  // are owned by 2B1 + 2A. This layer only enforces the version precondition.
  return applyDraftNodePlacementV2(draft, nodeKey, destination);
}
