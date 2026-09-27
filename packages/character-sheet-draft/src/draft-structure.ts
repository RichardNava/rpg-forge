import {
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";

export type DraftSubtreeRange = {
  start: number;
  endExclusive: number;
};

export type DraftStructuralIndex = {
  placementByKey: ReadonlyMap<string, DraftPlacement>;
  childrenByParent: ReadonlyMap<string | null, readonly DraftPlacement[]>;
  parentByKey: ReadonlyMap<string, string | null>;
  depthByKey: ReadonlyMap<string, number>;
  subtreeRangeBySectionKey: ReadonlyMap<string, DraftSubtreeRange>;
};

/**
 * Builds a derived structural index from a canonical V2 draft.
 * This is a pure in-memory computation; it does not mutate the draft.
 * structure[] remains the sole persisted structural authority.
 * All maps use RAW canonical keys (no compound IDs like "section:key").
 * Root is represented by null parentKey.
 */
export function buildDraftStructuralIndex(
  draft: CharacterSheetDraftV2,
): DraftStructuralIndex {
  const structure = draft.structure;

  // Build childrenByParent preserving structure[] order
  const childrenByParentMap = new Map<string | null, DraftPlacement[]>();
  for (const placement of structure) {
    const parentKey = placement.parentKey ?? null;
    if (!childrenByParentMap.has(parentKey)) {
      childrenByParentMap.set(parentKey, []);
    }
    childrenByParentMap.get(parentKey)!.push(placement);
  }

  // Build placementByKey using RAW keys
  const placementByKeyMap = new Map<string, DraftPlacement>();
  for (const placement of structure) {
    placementByKeyMap.set(placement.key, placement);
  }

  // Build parentByKey
  const parentByKeyMap = new Map<string, string | null>();
  for (const placement of structure) {
    parentByKeyMap.set(placement.key, placement.parentKey);
  }

  // Compute depthByKey and subtreeRangeBySectionKey via single DFS
  const depthByKeyMap = new Map<string, number>();
  const subtreeRangeBySectionKeyMap = new Map<string, DraftSubtreeRange>();

  function dfs(key: string, depth: number): { end: number } {
    depthByKeyMap.set(key, depth);
    const start = structure.findIndex((p) => p.key === key);
    let maxEnd = start + 1;

    const children = childrenByParentMap.get(key) ?? [];
    for (const child of children) {
      const childResult = dfs(child.key, depth + 1);
      maxEnd = Math.max(maxEnd, childResult.end);
    }

    // Only compute subtree ranges for sections
    const placement = placementByKeyMap.get(key);
    if (placement?.kind === "section") {
      subtreeRangeBySectionKeyMap.set(key, { start, endExclusive: maxEnd });
    }
    return { end: maxEnd };
  }

  // Start DFS from root placements
  const rootPlacements = structure.filter((p) => p.parentKey === null);
  for (const root of rootPlacements) {
    dfs(root.key, 0);
  }

  return {
    placementByKey: placementByKeyMap,
    childrenByParent: childrenByParentMap,
    parentByKey: parentByKeyMap,
    depthByKey: depthByKeyMap,
    subtreeRangeBySectionKey: subtreeRangeBySectionKeyMap,
  };
}

/** Returns the placement for a given key, or undefined if not found. */
export function getDraftPlacement(
  index: DraftStructuralIndex,
  key: string,
): DraftPlacement | undefined {
  return index.placementByKey.get(key);
}

/** Returns direct children of a parent, in structure[] order. */
export function getDraftChildren(
  index: DraftStructuralIndex,
  parentKey: string | null,
): readonly DraftPlacement[] {
  return index.childrenByParent.get(parentKey) ?? [];
}

/** Returns the parent key of a node, or undefined if not found. */
export function getDraftParentKey(
  index: DraftStructuralIndex,
  key: string,
): string | null | undefined {
  return index.parentByKey.get(key);
}

/** Returns the depth of a node, or undefined if not found. */
export function getDraftDepth(
  index: DraftStructuralIndex,
  key: string,
): number | undefined {
  return index.depthByKey.get(key);
}

/** Returns the subtree range for a section, or undefined if not found. */
export function getDraftSubtreeRange(
  index: DraftStructuralIndex,
  sectionKey: string,
): DraftSubtreeRange | undefined {
  return index.subtreeRangeBySectionKey.get(sectionKey);
}
