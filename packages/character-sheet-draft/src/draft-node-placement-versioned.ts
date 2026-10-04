import { type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { placeDraftNodeV2 } from "./draft-node-placement";
import { validateDraftV2 } from "./draft-schema-v2";
import type { DraftLayoutV1 } from "./draft-layout-v1";
import { nextDraftVersion } from "./versioning";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";
import { draftError } from "./errors";

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
  // A structural move never alters geometry behind the user's back: when an
  // explicit layout exists, the moved node's preserved geometry must still
  // fit its destination container, otherwise the move rejects before any
  // structural change. Never clamp. Skipped for confirmed drafts so the
  // primitive's draft_confirmed guard keeps its established precedence.
  if (draft.layout !== undefined && !draft.confirmed) {
    assertPreservedGeometryFitsDestination(
      draft,
      draft.layout,
      nodeKey,
      destination,
    );
  }

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

/**
 * Geometry preservation rule for structural moves. The node's layout entry is
 * carried over unchanged by the placement primitive; this pre-check verifies
 * it still fits the planned destination container. A structural move and a
 * geometry change are separate user intentions, so an incompatible
 * destination rejects as invalid_mutation instead of clamping or resetting
 * geometry. Structural no-ops skip the check: an unchanged parent trivially
 * still fits.
 */
function assertPreservedGeometryFitsDestination(
  draft: CharacterSheetDraftV2,
  layout: DraftLayoutV1,
  nodeKey: string,
  destination: DraftNodeDestination,
): void {
  const plan = planDraftNodePlacementV2(draft, nodeKey, destination);
  if (plan.isNoOp) {
    return;
  }
  const geometry = layout.nodes[nodeKey];
  if (geometry === undefined) {
    return;
  }
  const columns =
    plan.destinationParentKey === null
      ? layout.root.columns
      : (layout.sections[plan.destinationParentKey]?.columns ?? null);
  if (columns === null) {
    throw draftError(
      "invalid_mutation",
      `Destination section "${plan.destinationParentKey}" has no container layout.`,
    );
  }
  if (
    geometry.columnStart > columns ||
    geometry.columnStart + geometry.columnSpan - 1 > columns
  ) {
    throw draftError(
      "invalid_mutation",
      `Node "${nodeKey}" keeps its geometry, which does not fit the destination container with ${columns} columns. Change the node layout first.`,
    );
  }
}
