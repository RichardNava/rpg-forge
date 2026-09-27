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
 * Applies a field placement plan to a V2 draft, moving an existing FIELD
 * to a new structural position.
 *
 * This is a PURE structural mutation — it only modifies the structure[] array
 * by moving a single FIELD placement. It does NOT modify fields[], sections[],
 * values, or any other content registries.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param fieldKey - The key of the FIELD to move
 * @param destination - Where to place the field (before/after/inside)
 * @returns A new validated V2 draft with the field repositioned
 */
export function placeDraftFieldV2(
  draft: CharacterSheetDraftV2,
  fieldKey: string,
  destination: DraftNodeDestination,
): CharacterSheetDraftV2 {
  // Use the 2A1 planner to compute the geometric plan
  const plan = planDraftNodePlacementV2(draft, fieldKey, destination);

  // The planner validates that the node exists. Now verify it's a FIELD.
  if (plan.nodeKind !== "field") {
    throw draftError(
      "invalid_mutation",
      `Node "${fieldKey}" is not a field (it is a ${plan.nodeKind}).`,
    );
  }

  // If the planner says this is a structural no-op, return the original draft
  if (plan.isNoOp) {
    return draft;
  }

  // Verify the moving range represents exactly one field placement
  const movingLength = plan.movingRange.endExclusive - plan.movingRange.start;
  if (movingLength !== 1) {
    throw draftError(
      "invalid_mutation",
      `Expected moving range for field to have length 1, got ${movingLength}.`,
    );
  }

  // Verify the moving node is the expected field
  const structure = draft.structure;
  const movingPlacement = draft.structure[plan.movingRange.start];
  if (!movingPlacement || movingPlacement.kind !== "field") {
    throw draftError(
      "invalid_mutation",
      `Expected field at moving range start, found ${movingPlacement?.kind ?? "nothing"}.`,
    );
  }
  if (movingPlacement.key !== fieldKey) {
    throw draftError(
      "invalid_mutation",
      `Moving placement key "${movingPlacement.key}" does not match fieldKey "${fieldKey}".`,
    );
  }

  // Remove the field from its current position
  const remainingStructure = [
    ...draft.structure.slice(0, plan.movingRange.start),
    ...draft.structure.slice(plan.movingRange.endExclusive),
  ];

  // Create the moved placement with updated parentKey
  const movedPlacement: DraftPlacement = {
    kind: "field",
    key: fieldKey,
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
