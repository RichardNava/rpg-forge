import { z } from "zod";
import { draftError } from "./errors";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";

/**
 * Canonical spatial layout contract, version 1 (14.8 spatial foundation).
 *
 * A Draft declares WHAT exists (fields[], sections[]), HOW it is ordered
 * (structure[], the sole structural authority), and — optionally — WHERE it
 * sits on structured grids (layout). Layout is pure geometry: it carries no
 * parentKey, no children, no sibling ordering, no alternative tree, and no
 * second ordering authority. Hierarchy and canonical order always come from
 * structure[] alone.
 *
 * Geometry is structured/grid-based, never absolute pixels: containers declare
 * column counts, nodes declare grid placement relative to their CURRENT parent
 * container. Rows are deterministic auto-flow driven by canonical sibling
 * order plus columnStart/columnSpan/rowSpan/breakBefore — the same semantics
 * the CharacterSheetSpec/PDF grid engine already understands.
 *
 * Column bound: containers allow 1..4 columns. This deliberately mirrors the
 * flat `CharacterSheetSpec` bound (`MAX_LAYOUT_COLUMNS = 4` in
 * `@repo/character-sheet-schema`) and the PDF renderer's four-column grid.
 * 14.8 establishes the contract, not capacity expansion; rowSpan is bounded
 * 1..12, mirroring `MAX_ROW_SPAN = 12`. If product testing later requires a
 * wider grid, the bound moves deliberately in all three places at once.
 */
export const DRAFT_LAYOUT_V1_VERSION = "1" as const;

export const DRAFT_LAYOUT_MIN_COLUMNS = 1 as const;
export const DRAFT_LAYOUT_MAX_COLUMNS = 4 as const;
export const DRAFT_LAYOUT_MIN_ROW_SPAN = 1 as const;
export const DRAFT_LAYOUT_MAX_ROW_SPAN = 12 as const;

/**
 * Canonical key grammar, intentionally local (not imported) so this module
 * has no runtime dependency on the draft schema modules — `draft-schema-v2`
 * imports this module's schemas, and a value import back would be a module
 * evaluation cycle. The pattern mirrors the canonical key grammar exactly.
 */
const layoutKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const layoutKeySchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(layoutKeyPattern, "Layout keys must use safe canonical keys.");

/** Grid container: Root or one Section. Columns only — never hierarchy. */
export const DraftLayoutContainerV1Schema = z.strictObject({
  columns: z
    .number()
    .int()
    .min(DRAFT_LAYOUT_MIN_COLUMNS)
    .max(DRAFT_LAYOUT_MAX_COLUMNS),
});
export type DraftLayoutContainerV1 = z.infer<
  typeof DraftLayoutContainerV1Schema
>;

/**
 * Node geometry relative to the node's CURRENT parent container.
 * No parentKey, no order value, no rowStart: rows are deterministic auto-flow.
 */
export const DraftLayoutNodeV1Schema = z.strictObject({
  columnStart: z.number().int().min(1),
  columnSpan: z.number().int().min(1),
  rowSpan: z
    .number()
    .int()
    .min(DRAFT_LAYOUT_MIN_ROW_SPAN)
    .max(DRAFT_LAYOUT_MAX_ROW_SPAN),
  breakBefore: z.boolean(),
});
export type DraftLayoutNodeV1 = z.infer<typeof DraftLayoutNodeV1Schema>;

/**
 * Complete spatial layout for one draft snapshot. When present on a draft it
 * must be COMPLETE: every current Section has exactly one container entry,
 * and every current structural node (Field or Section) has exactly one node
 * entry. Upper geometry bounds (against the current parent container) are
 * enforced by `assertDraftLayoutComplete`, not by this shape alone.
 */
export const DraftLayoutV1Schema = z.strictObject({
  schemaVersion: z.literal(DRAFT_LAYOUT_V1_VERSION),
  root: DraftLayoutContainerV1Schema,
  sections: z.record(layoutKeySchema, DraftLayoutContainerV1Schema),
  nodes: z.record(layoutKeySchema, DraftLayoutNodeV1Schema),
});
export type DraftLayoutV1 = z.infer<typeof DraftLayoutV1Schema>;

/** The deterministic default node geometry: 1x1, no break. */
export const DEFAULT_DRAFT_NODE_LAYOUT_V1: DraftLayoutNodeV1 = {
  columnStart: 1,
  columnSpan: 1,
  rowSpan: 1,
  breakBefore: false,
};

/** The deterministic default container geometry: a single column. */
export const DEFAULT_DRAFT_CONTAINER_LAYOUT_V1: DraftLayoutContainerV1 = {
  columns: 1,
};

type DraftStructureLike = Pick<CharacterSheetDraftV2, "sections" | "structure">;

/**
 * Builds the complete deterministic default layout for a draft's current
 * structure: single-column Root, single-column Sections, 1x1 nodes, no
 * breaks. This exactly preserves pre-14.8 behavior and is the materialization
 * source for layoutless drafts.
 */
export function defaultDraftLayoutV1(draft: DraftStructureLike): DraftLayoutV1 {
  const sections: Record<string, DraftLayoutContainerV1> = {};
  for (const section of draft.sections) {
    sections[section.key] = { ...DEFAULT_DRAFT_CONTAINER_LAYOUT_V1 };
  }
  const nodes: Record<string, DraftLayoutNodeV1> = {};
  for (const placement of draft.structure) {
    nodes[placement.key] = { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 };
  }
  return {
    schemaVersion: DRAFT_LAYOUT_V1_VERSION,
    root: { ...DEFAULT_DRAFT_CONTAINER_LAYOUT_V1 },
    sections,
    nodes,
  };
}

/**
 * Resolves the COMPLETE effective layout for any valid V2 draft without
 * mutating it. An explicit layout is returned as-is after a completeness
 * assertion; a layoutless draft resolves to the deterministic defaults.
 *
 * There is exactly one package authority for effective layout defaults: this
 * function. No other default-layout builder may exist.
 */
export function resolveEffectiveDraftLayoutV1(
  draft: CharacterSheetDraftV2,
): DraftLayoutV1 {
  if (draft.layout === undefined) {
    return defaultDraftLayoutV1(draft);
  }
  assertDraftLayoutComplete(draft, draft.layout);
  return draft.layout;
}

/**
 * Returns the column count of the container that currently parents a node:
 * `layout.root.columns` for Root nodes, the owning Section's container
 * columns otherwise.
 *
 * @throws DraftError("invalid_mutation") when the node or its parent Section
 * has no layout entry (layout/db disagreement, never valid input)
 */
export function parentContainerColumnsForNode(
  draft: DraftStructureLike,
  layout: DraftLayoutV1,
  key: string,
): number {
  const placement = draft.structure.find((entry) => entry.key === key);
  if (placement === undefined) {
    throw draftError(
      "invalid_mutation",
      `Node "${key}" does not exist in the draft structure.`,
    );
  }
  if (placement.parentKey === null) {
    return layout.root.columns;
  }
  const container = layout.sections[placement.parentKey];
  if (container === undefined) {
    throw draftError(
      "invalid_mutation",
      `Parent section "${placement.parentKey}" has no container layout.`,
    );
  }
  return container.columns;
}

/**
 * Asserts that a layout is COMPLETE and internally valid for a draft's
 * current structure. No silent repair, no silent clamping: every violation
 * throws DraftError("invalid_draft") with an explicit message.
 *
 * Checked, in order:
 * - sections map holds exactly every current Section key (no missing, no
 *   unknown)
 * - nodes map holds exactly every current structural node key (no missing,
 *   no unknown — so every Field and every Section has exactly one entry)
 * - every node geometry fits its CURRENT parent container: columnStart within
 *   columns, and columnStart + columnSpan - 1 within columns
 */
export function assertDraftLayoutComplete(
  draft: DraftStructureLike,
  layout: DraftLayoutV1,
): void {
  const sectionKeys = new Set(draft.sections.map((entry) => entry.key));
  const layoutSectionKeys = new Set(Object.keys(layout.sections));
  for (const key of sectionKeys) {
    if (!layoutSectionKeys.has(key)) {
      throw draftError(
        "invalid_draft",
        `Section "${key}" has no container layout.`,
      );
    }
  }
  for (const key of layoutSectionKeys) {
    if (!sectionKeys.has(key)) {
      throw draftError(
        "invalid_draft",
        `Container layout references unknown section "${key}".`,
      );
    }
  }

  const nodeKeys = new Set(draft.structure.map((entry) => entry.key));
  const layoutNodeKeys = new Set(Object.keys(layout.nodes));
  for (const key of nodeKeys) {
    if (!layoutNodeKeys.has(key)) {
      throw draftError("invalid_draft", `Node "${key}" has no node layout.`);
    }
  }
  for (const key of layoutNodeKeys) {
    if (!nodeKeys.has(key)) {
      throw draftError(
        "invalid_draft",
        `Node layout references unknown node "${key}".`,
      );
    }
  }

  for (const placement of draft.structure) {
    const geometry = layout.nodes[placement.key];
    if (geometry === undefined) {
      continue;
    }
    const columns = parentContainerColumnsForNode(draft, layout, placement.key);
    if (geometry.columnStart > columns) {
      throw draftError(
        "invalid_draft",
        `Node "${placement.key}" starts at column ${geometry.columnStart} but its container has ${columns} columns.`,
      );
    }
    if (geometry.columnStart + geometry.columnSpan - 1 > columns) {
      throw draftError(
        "invalid_draft",
        `Node "${placement.key}" spans columns ${geometry.columnStart}..${geometry.columnStart + geometry.columnSpan - 1} but its container has ${columns} columns.`,
      );
    }
  }
}

/** Structural equality for node geometry (semantic no-op detection). */
export function draftNodeLayoutsEqual(
  a: DraftLayoutNodeV1,
  b: DraftLayoutNodeV1,
): boolean {
  return (
    a.columnStart === b.columnStart &&
    a.columnSpan === b.columnSpan &&
    a.rowSpan === b.rowSpan &&
    a.breakBefore === b.breakBefore
  );
}
