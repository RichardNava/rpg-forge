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
 * Applies a Section placement plan to a V2 draft, moving an existing SECTION
 * together with its complete subtree to a new structural position.
 *
 * This is a PURE structural mutation — it only modifies the structure[] array
 * by moving a complete Section subtree as one contiguous block. It does NOT
 * modify fields[], sections[], values, or any other content registries.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param sectionKey - The key of the SECTION to move
 * @param destination - Where to place the Section (before/after/inside)
 * @returns A new validated V2 draft with the Section subtree repositioned
 */
export function placeDraftSectionV2(
  draft: CharacterSheetDraftV2,
  sectionKey: string,
  destination: DraftNodeDestination,
): CharacterSheetDraftV2 {
  // Use the 2A1 planner to compute the geometric plan
  const plan = planDraftNodePlacementV2(draft, sectionKey, destination);

  // The planner validates that the node exists. Now verify it's a SECTION.
  if (plan.nodeKind !== "section") {
    throw draftError(
      "invalid_mutation",
      `Node "${sectionKey}" is not a section (it is a ${plan.nodeKind}).`,
    );
  }

  // If the planner says this is a structural no-op, return the original draft
  if (plan.isNoOp) {
    return draft;
  }

  // Extract the complete moving block (Section root + entire subtree)
  const structure = draft.structure;
  const movingRange = plan.movingRange;
  const movingBlock = structure.slice(
    movingRange.start,
    movingRange.endExclusive,
  );

  // Verify the moving block starts with the expected Section root
  const firstInBlock = movingBlock[0];
  if (!firstInBlock || firstInBlock.kind !== "section") {
    throw draftError(
      "invalid_mutation",
      `Expected Section at moving range start, found ${firstInBlock?.kind ?? "nothing"}.`,
    );
  }
  if (firstInBlock.key !== sectionKey) {
    throw draftError(
      "invalid_mutation",
      `Moving block root key "${firstInBlock.key}" does not match sectionKey "${sectionKey}".`,
    );
  }

  // Remove the entire moving block from structure
  const remainingStructure = [
    ...structure.slice(0, movingRange.start),
    ...structure.slice(movingRange.endExclusive),
  ];

  // Create updated root Section placement with new parentKey
  // Descendants remain structurally unchanged
  const updatedRootPlacement: DraftPlacement = {
    kind: "section",
    key: sectionKey,
    parentKey: plan.destinationParentKey,
  };

  // Reconstruct the moving block with updated root, preserving all descendants
  const updatedMovingBlock = [updatedRootPlacement, ...movingBlock.slice(1)];

  // Insert the complete updated block at the computed position
  const newStructure = [
    ...remainingStructure.slice(0, plan.insertionIndexAfterRemoval),
    ...updatedMovingBlock,
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
