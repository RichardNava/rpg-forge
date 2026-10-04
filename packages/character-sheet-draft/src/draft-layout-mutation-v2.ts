import { z } from "zod";
import { draftError } from "./errors";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import {
  DRAFT_LAYOUT_MAX_COLUMNS,
  DRAFT_LAYOUT_MAX_ROW_SPAN,
  DRAFT_LAYOUT_MIN_COLUMNS,
  DRAFT_LAYOUT_MIN_ROW_SPAN,
  DRAFT_LAYOUT_V1_VERSION,
  defaultDraftLayoutV1,
  draftNodeLayoutsEqual,
  parentContainerColumnsForNode,
  type DraftLayoutNodeV1,
  type DraftLayoutV1,
} from "./draft-layout-v1";
import {
  draftKeyPattern,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";

const layoutMutationKeySchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Layout keys must use safe canonical keys.");

const DraftNodePlacementInputV2Schema = z.strictObject({
  columnStart: z.number().int().min(1),
  columnSpan: z.number().int().min(1),
  rowSpan: z
    .number()
    .int()
    .min(DRAFT_LAYOUT_MIN_ROW_SPAN)
    .max(DRAFT_LAYOUT_MAX_ROW_SPAN),
  breakBefore: z.boolean(),
});

const DraftSetContainerLayoutMutationV2Schema = z.strictObject({
  op: z.literal("set_container_layout"),
  /** Null addresses Root; a string must identify an existing Section. */
  containerKey: layoutMutationKeySchema.nullable(),
  columns: z
    .number()
    .int()
    .min(DRAFT_LAYOUT_MIN_COLUMNS)
    .max(DRAFT_LAYOUT_MAX_COLUMNS),
});
export type DraftSetContainerLayoutMutationV2 = z.infer<
  typeof DraftSetContainerLayoutMutationV2Schema
>;

const DraftSetNodeLayoutMutationV2Schema = z.strictObject({
  op: z.literal("set_node_layout"),
  key: layoutMutationKeySchema,
  placement: DraftNodePlacementInputV2Schema,
});
export type DraftSetNodeLayoutMutationV2 = z.infer<
  typeof DraftSetNodeLayoutMutationV2Schema
>;

/**
 * Isolated V2 spatial layout mutation contract. `op` is the discriminant;
 * `expectedVersion` is deliberately OUT of the payload (pass it to the apply
 * function instead). Both operations edit ONLY `draft.layout`: registries,
 * values and structure[] are never touched here.
 */
export const DraftLayoutMutationV2Schema = z.discriminatedUnion("op", [
  DraftSetContainerLayoutMutationV2Schema,
  DraftSetNodeLayoutMutationV2Schema,
]);
export type DraftLayoutMutationV2 = z.infer<typeof DraftLayoutMutationV2Schema>;

/**
 * Parses untrusted input into a validated V2 layout mutation. Throws
 * `DraftError("invalid_mutation")` on rejection (including extra properties
 * and an `expectedVersion` smuggled into the payload).
 */
export function parseDraftLayoutMutationV2(
  input: unknown,
): DraftLayoutMutationV2 {
  const result = DraftLayoutMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The layout mutation is invalid."
        : `The layout mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies one validated V2 layout mutation to a canonical V2 draft.
 *
 * Precondition order is fixed and mirrors the other families:
 * 1. `expectedVersion === draft.version` (version_conflict wins over every
 *    lower-level validation)
 * 2. confirmed guard (draft_confirmed)
 * 3. mutation-specific target/domain validation
 * 4. semantic no-op detection (returns the EXACT original reference, no bump)
 * 5. immutable domain change
 * 6. version bumped exactly once via `nextDraftVersion`
 * 7. `baseVersion` preserved
 * 8. final result validated with `validateDraftV2`
 *
 * A layoutless draft materializes the complete effective default layout
 * before the requested change is applied, so the persisted result is always
 * either layoutless (untouched) or complete — never partial.
 */
export function applyDraftLayoutMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftLayoutMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  switch (mutation.op) {
    case "set_container_layout":
      return applySetContainerLayout(draft, mutation);
    case "set_node_layout":
      return applySetNodeLayout(draft, mutation);
  }
}

function assertMatchingVersion(
  draft: CharacterSheetDraftV2,
  expectedVersion: number,
): void {
  if (expectedVersion !== draft.version) {
    throw draftError(
      "version_conflict",
      `Expected version ${expectedVersion} but draft is at version ${draft.version}.`,
    );
  }
}

function assertV2Editable(draft: CharacterSheetDraftV2): void {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is confirmed and read-only; it cannot be mutated.",
    );
  }
}

function applySetContainerLayout(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetContainerLayoutMutationV2,
): CharacterSheetDraftV2 {
  if (mutation.containerKey !== null) {
    const section = draft.sections.find(
      (entry) => entry.key === mutation.containerKey,
    );
    if (section === undefined) {
      throw draftError(
        "invalid_mutation",
        `Container section "${mutation.containerKey}" does not exist.`,
      );
    }
  }

  const layout: DraftLayoutV1 =
    draft.layout === undefined
      ? defaultDraftLayoutV1(draft)
      : {
          schemaVersion: DRAFT_LAYOUT_V1_VERSION,
          root: { ...draft.layout.root },
          sections: { ...draft.layout.sections },
          nodes: { ...draft.layout.nodes },
        };
  const current =
    mutation.containerKey === null
      ? layout.root.columns
      : layout.sections[mutation.containerKey]?.columns;
  if (current === undefined) {
    throw draftError(
      "invalid_mutation",
      `Container section "${mutation.containerKey}" has no container layout.`,
    );
  }
  if (current === mutation.columns && draft.layout !== undefined) {
    return draft;
  }
  if (mutation.containerKey === null) {
    layout.root = { columns: mutation.columns };
  } else {
    layout.sections[mutation.containerKey] = { columns: mutation.columns };
  }

  // Reducing columns must never silently clamp child geometry: every direct
  // child whose placement would leave the container rejects the whole change.
  const invalidChildren = draft.structure
    .filter(
      (placement) =>
        (placement.parentKey ?? null) === (mutation.containerKey ?? null),
    )
    .map((placement) => placement.key)
    .filter((key) => {
      const geometry = layout.nodes[key];
      if (geometry === undefined) return false;
      return (
        geometry.columnStart > mutation.columns ||
        geometry.columnStart + geometry.columnSpan - 1 > mutation.columns
      );
    });
  if (invalidChildren.length > 0) {
    throw draftError(
      "invalid_mutation",
      `Container "${mutation.containerKey ?? "root"}" cannot shrink to ${mutation.columns} columns: ${invalidChildren
        .map((key) => `"${key}"`)
        .join(", ")} would no longer fit.`,
    );
  }

  return commitV2(draft, { ...draft, layout });
}

function applySetNodeLayout(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetNodeLayoutMutationV2,
): CharacterSheetDraftV2 {
  const placement = draft.structure.find((entry) => entry.key === mutation.key);
  if (placement === undefined) {
    throw draftError(
      "invalid_mutation",
      `Node "${mutation.key}" does not exist in the draft structure.`,
    );
  }

  const layout: DraftLayoutV1 =
    draft.layout === undefined
      ? defaultDraftLayoutV1(draft)
      : {
          schemaVersion: DRAFT_LAYOUT_V1_VERSION,
          root: { ...draft.layout.root },
          sections: { ...draft.layout.sections },
          nodes: { ...draft.layout.nodes },
        };
  const columns = parentContainerColumnsForNode(draft, layout, mutation.key);
  const next: DraftLayoutNodeV1 = { ...mutation.placement };
  const current = layout.nodes[mutation.key];
  if (
    current !== undefined &&
    draftNodeLayoutsEqual(current, next) &&
    draft.layout !== undefined
  ) {
    return draft;
  }
  assertGeometryFitsParent(mutation.key, next, columns);
  layout.nodes[mutation.key] = next;

  return commitV2(draft, { ...draft, layout });
}

function assertGeometryFitsParent(
  key: string,
  geometry: DraftLayoutNodeV1,
  columns: number,
): void {
  if (geometry.columnStart > columns) {
    throw draftError(
      "invalid_mutation",
      `Node "${key}" starts at column ${geometry.columnStart} but its container has ${columns} columns.`,
    );
  }
  if (geometry.columnStart + geometry.columnSpan - 1 > columns) {
    throw draftError(
      "invalid_mutation",
      `Node "${key}" spans columns ${geometry.columnStart}..${geometry.columnStart + geometry.columnSpan - 1} but its container has ${columns} columns.`,
    );
  }
}

function commitV2(
  draft: CharacterSheetDraftV2,
  next: CharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  const candidate: CharacterSheetDraftV2 = {
    ...next,
    version: nextDraftVersion(draft.version),
    baseVersion: draft.baseVersion,
  };
  validateDraftV2(candidate);
  return candidate;
}
