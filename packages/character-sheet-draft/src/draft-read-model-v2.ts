import type { DraftField } from "./draft-schema";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
  type DraftSectionV2,
} from "./draft-schema-v2";
import {
  buildDraftStructuralIndex,
  getDraftDepth,
  type DraftStructuralIndex,
} from "./draft-structure";
import { draftError } from "./errors";

/**
 * A canonical Field placement resolved against the Field registry.
 *
 * `placement` and `field` are the EXACT objects owned by `draft.structure` and
 * `draft.fields`; the read model only wraps them, it never clones, normalizes
 * or repairs them.
 */
export type DraftFieldReadNodeV2 = {
  readonly kind: "field";
  readonly key: string;
  readonly parentKey: string | null;
  readonly depth: number;
  readonly placement: Extract<DraftPlacement, { kind: "field" }>;
  readonly field: DraftField;
};

/**
 * A canonical Section placement resolved against the Section registry.
 *
 * `placement` and `section` are the EXACT objects owned by `draft.structure`
 * and `draft.sections`; the read model only wraps them.
 */
export type DraftSectionReadNodeV2 = {
  readonly kind: "section";
  readonly key: string;
  readonly parentKey: string | null;
  readonly depth: number;
  readonly placement: Extract<DraftPlacement, { kind: "section" }>;
  readonly section: DraftSectionV2;
};

/**
 * One resolved structural node.
 *
 * Deliberately flat: a node carries no `children[]`, because the child
 * relationships stay derived in `childrenByParent` and are never duplicated into
 * a second tree whose copies could diverge.
 */
export type DraftReadNodeV2 = DraftFieldReadNodeV2 | DraftSectionReadNodeV2;

/**
 * Derived, read-only structural view of a canonical V2 draft.
 *
 * Every view below (`preorder`, `roots`, `nodeByKey`, `childrenByParent`) holds
 * the SAME node wrapper instances, so the view is referentially coherent. This
 * is an in-memory computation only: `draft.structure[]` remains the sole
 * canonical structural authority and the read model is never persisted.
 */
export type DraftStructuralReadModelV2 = {
  readonly preorder: readonly DraftReadNodeV2[];
  readonly roots: readonly DraftReadNodeV2[];
  readonly nodeByKey: ReadonlyMap<string, DraftReadNodeV2>;
  readonly childrenByParent: ReadonlyMap<
    string | null,
    readonly DraftReadNodeV2[]
  >;
};

/**
 * Resolves a canonical V2 draft into a derived structural read model.
 *
 * This is the resolution layer ABOVE the approved 1C structural index: it adds
 * registry resolution (which Field/Section record a placement refers to) on top
 * of the hierarchy, parent, depth and subtree facts that
 * `buildDraftStructuralIndex` already owns. No hierarchy or depth logic is
 * duplicated or recomputed here.
 *
 * Canonical authority: `readModel.preorder` corresponds 1:1, in EXACT order,
 * with `draft.structure`. There is no sorting, no registry-order fallback, no
 * Section-first or Field-first grouping, and no "Other fields" bucket. Root
 * means only `placement.parentKey === null`, and root Fields and root Sections
 * stay interleaved in their canonical sibling order.
 *
 * `validateDraftV2` runs as a GATE first and the read model is then built from
 * the ORIGINAL draft, so the result carries the caller's own registry and
 * placement objects while malformed input still fails closed.
 *
 * Pure: nothing is mutated, no version is advanced, and no lifecycle,
 * projection or UI concept is involved.
 *
 * @param draft - A canonical V2 draft snapshot
 * @returns The derived structural read model
 * @throws DraftError("invalid_draft") when the draft is not valid V2, or when
 * a defensive post-gate resolution invariant does not hold
 */
export function buildDraftStructuralReadModelV2(
  draft: CharacterSheetDraftV2,
): DraftStructuralReadModelV2 {
  validateDraftV2(draft);

  const index = buildDraftStructuralIndex(draft);
  const fieldByKey = new Map<string, DraftField>();
  for (const field of draft.fields) {
    fieldByKey.set(field.key, field);
  }
  const sectionByKey = new Map<string, DraftSectionV2>();
  for (const section of draft.sections) {
    sectionByKey.set(section.key, section);
  }

  const preorder: DraftReadNodeV2[] = [];
  const nodeByKey = new Map<string, DraftReadNodeV2>();
  const childrenByParent = new Map<string | null, DraftReadNodeV2[]>();

  // One pass over structure[] in canonical order produces the preorder, the
  // node lookup and the direct-child buckets, preserving sibling order exactly.
  for (const placement of draft.structure) {
    const node = resolveReadNodeV2(placement, index, fieldByKey, sectionByKey);
    preorder.push(node);
    nodeByKey.set(node.key, node);
    const parentKey = node.parentKey;
    const siblings = childrenByParent.get(parentKey);
    if (siblings === undefined) {
      childrenByParent.set(parentKey, [node]);
    } else {
      siblings.push(node);
    }
  }

  return {
    preorder,
    roots: childrenByParent.get(null) ?? [],
    nodeByKey,
    childrenByParent,
  };
}

function resolveReadNodeV2(
  placement: DraftPlacement,
  index: DraftStructuralIndex,
  fieldByKey: ReadonlyMap<string, DraftField>,
  sectionByKey: ReadonlyMap<string, DraftSectionV2>,
): DraftReadNodeV2 {
  // Depth is owned by the approved structural index; this layer never
  // recomputes it independently.
  const depth = getDraftDepth(index, placement.key);
  if (depth === undefined) {
    throw draftError(
      "invalid_draft",
      `Draft placement "${placement.key}" is not reachable in the canonical structure.`,
    );
  }
  const parentKey = placement.parentKey ?? null;

  if (placement.kind === "field") {
    const field = fieldByKey.get(placement.key);
    if (field === undefined) {
      throw draftError(
        "invalid_draft",
        `Draft placement references unknown Field "${placement.key}".`,
      );
    }
    return {
      kind: "field",
      key: placement.key,
      parentKey,
      depth,
      placement,
      field,
    };
  }

  const section = sectionByKey.get(placement.key);
  if (section === undefined) {
    throw draftError(
      "invalid_draft",
      `Draft placement references unknown Section "${placement.key}".`,
    );
  }
  return {
    kind: "section",
    key: placement.key,
    parentKey,
    depth,
    placement,
    section,
  };
}
