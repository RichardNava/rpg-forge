import {
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import { buildDraftStructuralIndex, getDraftDepth } from "./draft-structure";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";
import { placeDraftFieldV2 } from "./draft-field-placement";
import { placeDraftSectionV2 } from "./draft-section-placement";
import { draftError } from "./errors";
import { MAX_DRAFT_SECTION_DEPTH } from "./draft-schema";

/**
 * Guarded structural placement entry point for existing V2 nodes.
 *
 * This function provides domain-level guards before delegating to the
 * approved low-level structural primitives.
 *
 * Guards:
 * 1. confirmed draft rejection (draft_confirmed)
 * 2. unknown node rejection (invalid_mutation)
 * 3. Section depth preflight (invalid_mutation)
 *
 * Then dispatches to:
 * - placeDraftFieldV2() for Fields
 * - placeDraftSectionV2() for Sections
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param nodeKey - The key of the node (Field or Section) to move
 * @param destination - Where to place the node (before/after/inside)
 * @returns A new validated V2 draft with the node repositioned
 */
export function placeDraftNodeV2(
  draft: CharacterSheetDraftV2,
  nodeKey: string,
  destination: DraftNodeDestination,
): CharacterSheetDraftV2 {
  // 1. CONFIRMED GUARD - FIRST
  if (draft.confirmed) {
    throw draftError(
      "draft_confirmed",
      "Cannot structurally mutate a confirmed draft.",
    );
  }

  // 2. NODE RESOLUTION - use structural index
  const index = buildDraftStructuralIndex(draft);
  const movingPlacement = index.placementByKey.get(nodeKey);
  if (!movingPlacement) {
    throw draftError("invalid_mutation", `Node "${nodeKey}" does not exist.`);
  }

  // 3. FIELD DISPATCH - no depth check needed
  if (movingPlacement.kind === "field") {
    return placeDraftFieldV2(draft, nodeKey, destination);
  }

  // 4. SECTION DISPATCH - with depth preflight
  if (movingPlacement.kind === "section") {
    // Get planner plan for destination parent
    const plan = planDraftNodePlacementV2(draft, nodeKey, destination);

    // If no-op, let the primitive handle it (returns exact draft reference)
    if (plan.isNoOp) {
      return placeDraftSectionV2(draft, nodeKey, destination);
    }

    // Calculate relative subtree Section depth
    const movingRange = plan.movingRange;
    const structure = draft.structure;
    const movingBlock = structure.slice(
      movingRange.start,
      movingRange.endExclusive,
    );

    // Find deepest Section in the moving subtree
    let deepestSectionDepth =
      movingPlacement.kind === "section"
        ? (index.depthByKey.get(nodeKey) ?? 0)
        : -1;

    // Only Section placements contribute to Section hierarchy depth
    for (const placement of movingBlock) {
      if (placement.kind === "section") {
        const depth = index.depthByKey.get(placement.key) ?? 0;
        if (depth > deepestSectionDepth) {
          deepestSectionDepth = depth;
        }
      }
    }

    const currentRootDepth = index.depthByKey.get(nodeKey) ?? 0;
    const relativeSubtreeSectionDepth = deepestSectionDepth - currentRootDepth;

    // Calculate projected root depth using planner's destinationParentKey
    const destinationParentKey = plan.destinationParentKey;
    let projectedRootDepth: number;

    if (destinationParentKey === null) {
      // Moving to root level
      projectedRootDepth = 0;
    } else {
      // Moving inside a Section - depth is parent depth + 1
      const parentDepth = getDraftDepth(index, destinationParentKey);
      projectedRootDepth = (parentDepth ?? 0) + 1;
    }

    // Calculate projected deepest Section depth
    const projectedDeepestSectionDepth =
      projectedRootDepth + relativeSubtreeSectionDepth;

    // Check depth limit
    if (projectedDeepestSectionDepth > MAX_DRAFT_SECTION_DEPTH) {
      throw draftError(
        "invalid_mutation",
        `Projected Section depth ${projectedDeepestSectionDepth} exceeds maximum of ${MAX_DRAFT_SECTION_DEPTH}.`,
      );
    }

    // Depth-safe: delegate to approved primitive
    return placeDraftSectionV2(draft, nodeKey, destination);
  }

  // Should not reach here - all node kinds handled
  throw draftError("invalid_mutation", `Unknown node kind for "${nodeKey}".`);
}
