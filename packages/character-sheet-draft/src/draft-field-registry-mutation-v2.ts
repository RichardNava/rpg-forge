import { z } from "zod";
import { draftError } from "./errors";
import {
  DraftFieldSchema,
  DraftFieldTypeSchema,
  MAX_DRAFT_CHOICE_OPTION_CHARS,
  MAX_DRAFT_CHOICE_OPTIONS,
  MAX_DRAFT_FIELD_KEY_CHARS,
  MAX_DRAFT_FIELD_LABEL_CHARS,
  MAX_DRAFT_SURFACE_FIELDS,
  type DraftField,
} from "./draft-schema";
import {
  draftKeyPattern,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import {
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  type DraftLayoutV1,
} from "./draft-layout-v1";
import { nextDraftVersion } from "./versioning";

const REGISTRY_MUTATION_KEY_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Field keys must use safe canonical keys.");

const REGISTRY_MUTATION_LABEL_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_LABEL_CHARS)
  .regex(/\S/, "A field label must contain non-whitespace.");

const REGISTRY_MUTATION_OPTION_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_CHOICE_OPTION_CHARS)
  .regex(/\S/);

const REGISTRY_MUTATION_OPTIONS_SCHEMA = z
  .array(REGISTRY_MUTATION_OPTION_SCHEMA)
  .min(1)
  .max(MAX_DRAFT_CHOICE_OPTIONS);

const DraftAddFieldMutationV2Schema = z.strictObject({
  op: z.literal("add_field"),
  field: z.strictObject({
    key: REGISTRY_MUTATION_KEY_SCHEMA,
    label: REGISTRY_MUTATION_LABEL_SCHEMA,
    type: DraftFieldTypeSchema,
    locked: z.boolean().default(false),
    options: REGISTRY_MUTATION_OPTIONS_SCHEMA.optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  }),
});
export type DraftAddFieldMutationV2 = z.infer<
  typeof DraftAddFieldMutationV2Schema
>;

const DraftRemoveFieldMutationV2Schema = z.strictObject({
  op: z.literal("remove_field"),
  key: REGISTRY_MUTATION_KEY_SCHEMA,
});
export type DraftRemoveFieldMutationV2 = z.infer<
  typeof DraftRemoveFieldMutationV2Schema
>;

/**
 * Isolated V2 field registry mutation contract. `op` is the discriminant;
 * `expectedVersion` is deliberately OUT of the payload (pass it to the apply
 * function instead). add_field/remove_field modify the Field registry and
 * MUST keep structure[] synchronized, so the apply function owns the single
 * canonical placement change for each operation.
 */
export const DraftFieldRegistryMutationV2Schema = z.discriminatedUnion("op", [
  DraftAddFieldMutationV2Schema,
  DraftRemoveFieldMutationV2Schema,
]);
export type DraftFieldRegistryMutationV2 = z.infer<
  typeof DraftFieldRegistryMutationV2Schema
>;

/**
 * Parses untrusted input into a validated V2 field registry mutation. Throws
 * `DraftError("invalid_mutation")` on rejection (including extra properties
 * and an `expectedVersion` smuggled into the payload). For add_field the field
 * definition is additionally validated against `DraftFieldSchema` here so a
 * malformed Field (bad choice, invalid bounds) fails as a mutation error, not
 * as a later invalid_draft.
 */
export function parseDraftFieldRegistryMutationV2(
  input: unknown,
): DraftFieldRegistryMutationV2 {
  const result = DraftFieldRegistryMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The field registry mutation is invalid."
        : `The field registry mutation is invalid: ${first.message}`,
    );
  }
  if (result.data.op !== "add_field") {
    return result.data;
  }
  const field = parseFieldDefinition(result.data.field);
  return { ...result.data, field };
}

/**
 * Applies one validated V2 field registry mutation to a canonical V2 draft.
 *
 * Precondition order is fixed and mirrors 4A1:
 * 1. `expectedVersion === draft.version` (version_conflict wins over every
 *    lower-level validation)
 * 2. confirmed guard (draft_confirmed)
 * 3. mutation-specific target/domain validation
 * 4. immutable change (fields[] + structure[] stay synchronized)
 * 5. version bumped exactly once via `nextDraftVersion`
 * 6. `baseVersion` preserved
 * 7. `validateDraftV2` used as a validation GATE
 * 8. the constructed candidate is returned (not Zod's parsed clone)
 *
 * add_field is NEVER a no-op; remove_field is NEVER a no-op.
 */
export function applyDraftFieldRegistryMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftFieldRegistryMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  switch (mutation.op) {
    case "add_field":
      return applyAddField(draft, mutation);
    case "remove_field":
      return applyRemoveField(draft, mutation);
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

function applyAddField(
  draft: CharacterSheetDraftV2,
  mutation: DraftAddFieldMutationV2,
): CharacterSheetDraftV2 {
  const field = parseFieldDefinition(mutation.field);
  if (draft.fields.some((entry) => entry.key === field.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft field "${field.key}" already exists.`,
    );
  }
  if (draft.sections.some((section) => section.key === field.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft field key "${field.key}" collides with an existing section.`,
    );
  }
  if (draft.fields.length >= MAX_DRAFT_SURFACE_FIELDS) {
    throw draftError(
      "surface_out_of_bounds",
      `A draft surface may contain at most ${MAX_DRAFT_SURFACE_FIELDS} fields.`,
    );
  }

  const newPlacement: DraftPlacement = {
    kind: "field",
    key: field.key,
    parentKey: null,
  };
  return commitV2(draft, {
    ...draft,
    fields: [...draft.fields, field],
    structure: [...draft.structure, newPlacement],
    layout: withAddedNodeLayout(draft.layout, field.key),
  });
}

function applyRemoveField(
  draft: CharacterSheetDraftV2,
  mutation: DraftRemoveFieldMutationV2,
): CharacterSheetDraftV2 {
  const field = draft.fields.find((entry) => entry.key === mutation.key);
  if (field === undefined) {
    throw draftError(
      "surface_out_of_bounds",
      `Draft field "${mutation.key}" is outside the editable surface.`,
    );
  }
  if (draft.fields.length <= 1) {
    throw draftError(
      "surface_out_of_bounds",
      "A draft must retain at least one field.",
    );
  }

  let values = draft.values;
  if (values[field.key] !== undefined) {
    values = { ...values };
    delete values[field.key];
  }
  const characterName =
    field.key === "character_name" ? null : draft.characterName;
  const layout = draft.layout === undefined ? undefined : { ...draft.layout };
  if (layout !== undefined) {
    const nodes = { ...layout.nodes };
    delete nodes[field.key];
    layout.nodes = nodes;
  }
  return commitV2(draft, {
    ...draft,
    fields: draft.fields.filter((entry) => entry.key !== field.key),
    structure: draft.structure.filter(
      (placement) =>
        !(placement.kind === "field" && placement.key === field.key),
    ),
    values,
    characterName,
    layout,
  });
}

/**
 * Layout maintenance for add_field: an explicit layout gains the default node
 * entry for the new Field; a layoutless draft stays layoutless (never
 * partial).
 */
function withAddedNodeLayout(
  layout: DraftLayoutV1 | undefined,
  key: string,
): DraftLayoutV1 | undefined {
  if (layout === undefined) {
    return undefined;
  }
  return {
    ...layout,
    nodes: { ...layout.nodes, [key]: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 } },
  };
}

function parseFieldDefinition(input: unknown): DraftField {
  const result = DraftFieldSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The new field is invalid."
        : `The new field is invalid: ${first.message}`,
    );
  }
  return result.data;
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
