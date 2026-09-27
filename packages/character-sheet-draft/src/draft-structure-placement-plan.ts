import { z } from "zod";
import {
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import {
  buildDraftStructuralIndex,
  getDraftPlacement,
  getDraftParentKey,
  getDraftSubtreeRange,
  type DraftStructuralIndex,
  type DraftSubtreeRange,
} from "./draft-structure";
import { draftError } from "./errors";
import { MAX_DRAFT_SECTION_DEPTH } from "./draft-schema";

/**
 * Destination for a node placement operation.
 * Represents where a node should be moved in the structural hierarchy.
 */
export const DraftNodeDestinationSchema = z.discriminatedUnion("position", [
  z.strictObject({
    position: z.literal("before"),
    targetKey: z.string().min(1),
  }),
  z.strictObject({
    position: z.literal("after"),
    targetKey: z.string().min(1),
  }),
  z.strictObject({
    position: z.literal("inside"),
    parentKey: z.string().min(1).nullable(),
  }),
]);
export type DraftNodeDestination = z.infer<typeof DraftNodeDestinationSchema>;

export type DraftStructureRange = {
  start: number;
  endExclusive: number;
};

export type DraftNodePlacementPlan = {
  nodeKey: string;
  nodeKind: "field" | "section";

  movingRange: DraftStructureRange;

  currentParentKey: string | null;
  destinationParentKey: string | null;

  insertionBoundaryOriginal: number;
  insertionIndexAfterRemoval: number;

  isNoOp: boolean;
};

/**
 * Plans the placement of a node in a V2 draft structure.
 * This is a PURE planning function — it does NOT mutate the draft,
 * does not create a new draft, does not modify structure[],
 * and does not change any parentKey or other content.
 *
 * It calculates where a node (Field or Section) would be placed
 * given a destination, returning a plan that describes the geometry
 * of the move without performing it.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param nodeKey - The key of the node (Field or Section) to move
 * @param destination - Where to place the node (before/after/inside)
 * @returns A plan describing the geometry of the move
 */
export function planDraftNodePlacementV2(
  draft: CharacterSheetDraftV2,
  nodeKey: string,
  destination: DraftNodeDestination,
): DraftNodePlacementPlan {
  // Build structural index for efficient lookups
  const index = buildDraftStructuralIndex(draft);

  // Verify nodeKey exists
  const movingPlacement = getDraftPlacement(index, nodeKey);
  if (!movingPlacement) {
    throw draftError("invalid_mutation", `Node "${nodeKey}" does not exist.`);
  }

  // Resolve destination and compute plan
  const plan = resolveDestinationAndPlan(
    draft,
    index,
    movingPlacement,
    destination,
  );

  return plan;
}

/**
 * Resolves a destination to a placement plan using the ORIGINAL
 * structure array indexes.
 */
function resolveDestinationAndPlan(
  draft: CharacterSheetDraftV2,
  index: DraftStructuralIndex,
  movingPlacement: DraftPlacement,
  destination: DraftNodeDestination,
): DraftNodePlacementPlan {
  const structure = draft.structure;
  const movingIndex = structure.findIndex((p) => p.key === movingPlacement.key);

  // Compute moving range
  const movingRange = getMovingRange(structure, index, movingPlacement);
  const movingLength = movingRange.endExclusive - movingRange.start;

  // Current parent
  const currentParentKey = movingPlacement.parentKey;

  // Validate and resolve destination
  let destinationParentKey: string | null;
  let insertionBoundaryOriginal: number;

  if (destination.position === "before") {
    const targetPlacement = getDraftPlacement(index, destination.targetKey);
    if (!targetPlacement) {
      throw draftError(
        "invalid_mutation",
        `Target "${destination.targetKey}" does not exist.`,
      );
    }
    const targetIndex = structure.findIndex(
      (p) => p.key === destination.targetKey,
    );
    insertionBoundaryOriginal = targetIndex;
    destinationParentKey = targetPlacement.parentKey;
  } else if (destination.position === "after") {
    const targetPlacement = getDraftPlacement(index, destination.targetKey);
    if (!targetPlacement) {
      throw draftError(
        "invalid_mutation",
        `Target "${destination.targetKey}" does not exist.`,
      );
    }
    const targetIndex = structure.findIndex(
      (p) => p.key === destination.targetKey,
    );

    if (targetPlacement.kind === "section") {
      // After a Section means AFTER its entire subtree
      const targetRange = getDraftSubtreeRange(index, destination.targetKey);
      if (!targetRange) {
        throw draftError(
          "invalid_mutation",
          `Target Section "${destination.targetKey}" has no subtree range.`,
        );
      }
      insertionBoundaryOriginal = targetRange.endExclusive;
    } else {
      // After a Field means immediately after it
      insertionBoundaryOriginal = targetIndex + 1;
    }
    destinationParentKey = targetPlacement.parentKey;
  } else {
    // inside
    const parentKey = destination.parentKey;

    // Validate parentKey if provided
    if (parentKey !== null) {
      const parentPlacement = getDraftPlacement(index, parentKey);
      if (!parentPlacement) {
        throw draftError(
          "invalid_mutation",
          `Parent Section "${parentKey}" does not exist.`,
        );
      }
      if (parentPlacement.kind !== "section") {
        throw draftError(
          "invalid_mutation",
          `Parent "${parentKey}" is not a Section.`,
        );
      }
    }
    destinationParentKey = parentKey;

    if (parentKey === null) {
      // Insert at end of root level
      insertionBoundaryOriginal = draft.structure.length;
    } else {
      // Insert at end of parent's children (after all descendants)
      const parentRange = getDraftSubtreeRange(index, parentKey);
      if (!parentRange) {
        throw draftError(
          "invalid_mutation",
          `Parent Section "${parentKey}" has no subtree range.`,
        );
      }
      insertionBoundaryOriginal = parentRange.endExclusive;
    }
  }

  // Build and return the plan
  return buildPlan(
    draft,
    index,
    movingPlacement,
    movingRange,
    currentParentKey,
    destinationParentKey,
    insertionBoundaryOriginal,
    destination,
  );
}

function buildPlan(
  draft: CharacterSheetDraftV2,
  index: DraftStructuralIndex,
  movingPlacement: DraftPlacement,
  movingRange: DraftStructureRange,
  currentParentKey: string | null,
  destinationParentKey: string | null,
  insertionBoundaryOriginal: number,
  destination: DraftNodeDestination,
): DraftNodePlacementPlan {
  const movingLength = movingRange.endExclusive - movingRange.start;

  // Compute insertion index after removal
  let insertionIndexAfterRemoval: number;
  if (insertionBoundaryOriginal <= movingRange.start) {
    insertionIndexAfterRemoval = insertionBoundaryOriginal;
  } else if (insertionBoundaryOriginal >= movingRange.endExclusive) {
    insertionIndexAfterRemoval = insertionBoundaryOriginal - movingLength;
  } else {
    // Boundary strictly inside moving block — invalid/ambiguous
    throw draftError(
      "invalid_mutation",
      `Destination anchor lies inside the moving block; operation is ambiguous.`,
    );
  }

  // Validate: target must not be inside moving subtree (for sections)
  if (movingPlacement.kind === "section") {
    const targetKey = getTargetKey(destination);
    if (targetKey && isInSubtree(index, targetKey, movingPlacement.key)) {
      throw draftError(
        "invalid_mutation",
        `Cannot move Section "${movingPlacement.key}" into its own subtree.`,
      );
    }

    // Self-targeting
    if (targetKey === movingPlacement.key) {
      throw draftError(
        "invalid_mutation",
        `Cannot move node "${movingPlacement.key}" relative to itself.`,
      );
    }
  } else {
    // For Fields, check self-targeting
    const targetKey = getTargetKey(destination);
    if (targetKey === movingPlacement.key) {
      throw draftError(
        "invalid_mutation",
        `Cannot move node "${movingPlacement.key}" relative to itself.`,
      );
    }
  }

  // Determine if this is a structural no-op
  const isNoOp =
    destinationParentKey === currentParentKey &&
    insertionIndexAfterRemoval === movingRange.start;

  return {
    nodeKey: movingPlacement.key,
    nodeKind: movingPlacement.kind,
    movingRange,
    currentParentKey: movingPlacement.parentKey,
    destinationParentKey,
    insertionBoundaryOriginal,
    insertionIndexAfterRemoval,
    isNoOp,
  };
}

function getMovingRange(
  structure: readonly DraftPlacement[],
  index: DraftStructuralIndex,
  placement: DraftPlacement,
): DraftStructureRange {
  if (placement.kind === "field") {
    const idx = structure.findIndex((p) => p.key === placement.key);
    return { start: idx, endExclusive: idx + 1 };
  } else {
    const range = getDraftSubtreeRange(index, placement.key);
    if (!range) {
      throw new Error(`Section ${placement.key} has no subtree range`);
    }
    return range;
  }
}

/**
 * Gets the target key from a destination, or null if "inside" with null parent.
 */
function getTargetKey(destination: DraftNodeDestination): string | null {
  if (destination.position === "inside") {
    return destination.parentKey;
  }
  return destination.targetKey;
}

/**
 * Checks if a target key is inside a given subtree (is a descendant of the moving section).
 */
function isInSubtree(
  index: DraftStructuralIndex,
  targetKey: string,
  ancestorKey: string,
): boolean {
  const parentMap = index.parentByKey;
  let current: string | null | undefined = index.parentByKey.get(targetKey);
  while (current !== null && current !== undefined) {
    if (current === ancestorKey) return true;
    current = index.parentByKey.get(current);
  }
  return false;
}
