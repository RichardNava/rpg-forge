import {
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";
import { validateDraftV2 } from "./draft-schema-v2";
import { draftError } from "./errors";

/**
 * Applies a slot placement plan to a V2 draft, moving an existing portrait
 * SLOT to a new structural position.
 *
 * A Slot is a leaf exactly like a Field for placement purposes: it moves as a
 * single placement entry, keeps its geometry and aspect ratio untouched, and
 * can never parent anything. This is a PURE structural mutation — it only
 * modifies the structure[] array by moving a single SLOT placement.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param slotKey - The key of the SLOT to move
 * @param destination - Where to place the slot (before/after/inside)
 * @returns A new validated V2 draft with the slot repositioned
 */
export function placeDraftSlotV2(
  draft: CharacterSheetDraftV2,
  slotKey: string,
  destination: DraftNodeDestination,
): CharacterSheetDraftV2 {
  // Use the 2A1 planner to compute the geometric plan
  const plan = planDraftNodePlacementV2(draft, slotKey, destination);

  // The planner validates that the node exists. Now verify it's a SLOT.
  if (plan.nodeKind !== "slot") {
    throw draftError(
      "invalid_mutation",
      `Node "${slotKey}" is not a slot (it is a ${plan.nodeKind}).`,
    );
  }

  // If the planner says this is a structural no-op, return the original draft
  if (plan.isNoOp) {
    return draft;
  }

  // Verify the moving range represents exactly one slot placement
  const movingLength = plan.movingRange.endExclusive - plan.movingRange.start;
  if (movingLength !== 1) {
    throw draftError(
      "invalid_mutation",
      `Expected moving range for slot to have length 1, got ${movingLength}.`,
    );
  }

  // Verify the moving node is the expected slot
  const structure = draft.structure;
  const movingPlacement = draft.structure[plan.movingRange.start];
  if (!movingPlacement || movingPlacement.kind !== "slot") {
    throw draftError(
      "invalid_mutation",
      `Expected slot at moving range start, found ${movingPlacement?.kind ?? "nothing"}.`,
    );
  }
  if (movingPlacement.key !== slotKey) {
    throw draftError(
      "invalid_mutation",
      `Moving placement key "${movingPlacement.key}" does not match slotKey "${slotKey}".`,
    );
  }

  // Remove the slot from its current position
  const remainingStructure = [
    ...draft.structure.slice(0, plan.movingRange.start),
    ...draft.structure.slice(plan.movingRange.endExclusive),
  ];

  // Create the moved placement with updated parentKey
  const movedPlacement: DraftPlacement = {
    kind: "slot",
    key: slotKey,
    parentKey: plan.destinationParentKey,
  };

  // Insert at the computed position
  const newStructure = [
    ...remainingStructure.slice(0, plan.insertionIndexAfterRemoval),
    movedPlacement,
    ...remainingStructure.slice(plan.insertionIndexAfterRemoval),
  ];

  // Construct the new draft with updated structure
  const newDraft: CharacterSheetDraftV2 = {
    ...draft,
    structure: newStructure,
  };

  // Validate the resulting draft
  return validateDraftV2(newDraft);
}
