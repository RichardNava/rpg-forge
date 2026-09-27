import { type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { placeDraftNodeV2 } from "./draft-node-placement";
import { validateDraftV2 } from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";
import { type DraftNodeDestination } from "./draft-structure-placement-plan";

/**
 * Versioned structural placement wrapper.
 *
 * Delegates all structural semantics to placeDraftNodeV2(), then:
 * - If no-op (exact same reference returned): returns original draft unchanged
 * - If real change: bumps version exactly once, preserves baseVersion, validates V2
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param nodeKey - The key of the node (Field or Section) to move
 * @param destination - Where to place the node (before/after/inside)
 * @returns A new validated V2 draft with version bumped if structure changed
 */
export function applyDraftNodePlacementV2(
  draft: CharacterSheetDraftV2,
  nodeKey: string,
  destination: DraftNodeDestination,
): CharacterSheetDraftV2 {
  // Delegate all structural placement logic to the guarded primitive
  const placed = placeDraftNodeV2(draft, nodeKey, destination);

  // No-op: exact same reference returned -> return original unchanged
  if (placed === draft) {
    return draft;
  }

  // Real structural change: bump version exactly once
  const newVersion = nextDraftVersion(draft.version);

  // Construct new snapshot with bumped version, preserving baseVersion
  const newDraft: CharacterSheetDraftV2 = {
    ...placed,
    version: newVersion,
    baseVersion: draft.baseVersion,
  };

  // Final V2 validation
  return validateDraftV2(newDraft);
}
