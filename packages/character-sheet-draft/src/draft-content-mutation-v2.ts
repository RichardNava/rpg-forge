import { z } from "zod";
import { draftError } from "./errors";
import {
  DraftFieldTypeSchema,
  DraftValueSchema,
  MAX_DRAFT_CHOICE_OPTION_CHARS,
  MAX_DRAFT_CHOICE_OPTIONS,
  MAX_DRAFT_FIELD_KEY_CHARS,
  MAX_DRAFT_FIELD_LABEL_CHARS,
  type DraftField,
  type DraftValue,
} from "./draft-schema";
import {
  draftKeyPattern,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";

const contentMutationKeySchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Field keys must use safe canonical keys.");

const contentMutationLabelSchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_LABEL_CHARS)
  .regex(/\S/, "A field label must contain non-whitespace.");

const contentMutationOptionSchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_CHOICE_OPTION_CHARS)
  .regex(/\S/);

const contentMutationOptionsSchema = z
  .array(contentMutationOptionSchema)
  .min(1)
  .max(MAX_DRAFT_CHOICE_OPTIONS);

const DraftSetValueMutationV2Schema = z.strictObject({
  op: z.literal("set_value"),
  key: contentMutationKeySchema,
  value: DraftValueSchema,
});
export type DraftSetValueMutationV2 = z.infer<
  typeof DraftSetValueMutationV2Schema
>;

const DraftClearValueMutationV2Schema = z.strictObject({
  op: z.literal("clear_value"),
  key: contentMutationKeySchema,
});
export type DraftClearValueMutationV2 = z.infer<
  typeof DraftClearValueMutationV2Schema
>;

const DraftSetFieldLabelMutationV2Schema = z.strictObject({
  op: z.literal("set_field_label"),
  key: contentMutationKeySchema,
  label: contentMutationLabelSchema,
});
export type DraftSetFieldLabelMutationV2 = z.infer<
  typeof DraftSetFieldLabelMutationV2Schema
>;

const DraftSetFieldTypeMutationV2Schema = z.strictObject({
  op: z.literal("set_field_type"),
  field: z.strictObject({
    key: contentMutationKeySchema,
    type: DraftFieldTypeSchema,
    options: contentMutationOptionsSchema.optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  }),
});
export type DraftSetFieldTypeMutationV2 = z.infer<
  typeof DraftSetFieldTypeMutationV2Schema
>;

const DraftLockFieldMutationV2Schema = z.strictObject({
  op: z.literal("lock_field"),
  key: contentMutationKeySchema,
});
export type DraftLockFieldMutationV2 = z.infer<
  typeof DraftLockFieldMutationV2Schema
>;

const DraftUnlockFieldMutationV2Schema = z.strictObject({
  op: z.literal("unlock_field"),
  key: contentMutationKeySchema,
});
export type DraftUnlockFieldMutationV2 = z.infer<
  typeof DraftUnlockFieldMutationV2Schema
>;

/**
 * Isolated V2 content/value mutation contract. `op` is the discriminant;
 * `expectedVersion` is deliberately OUT of the payload (pass it to the apply
 * function instead). The six operations are non-structural: they only touch
 * the field registry (label/type/lock) and the values map, never sections[] or
 * structure[].
 */
export const DraftContentMutationV2Schema = z.discriminatedUnion("op", [
  DraftSetValueMutationV2Schema,
  DraftClearValueMutationV2Schema,
  DraftSetFieldLabelMutationV2Schema,
  DraftSetFieldTypeMutationV2Schema,
  DraftLockFieldMutationV2Schema,
  DraftUnlockFieldMutationV2Schema,
]);
export type DraftContentMutationV2 = z.infer<
  typeof DraftContentMutationV2Schema
>;

/**
 * Parses untrusted input into a validated V2 content mutation. Throws
 * `DraftError("invalid_mutation")` on rejection (including extra properties
 * and an `expectedVersion` smuggled into the payload).
 */
export function parseDraftContentMutationV2(
  input: unknown,
): DraftContentMutationV2 {
  const result = DraftContentMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The content mutation is invalid."
        : `The content mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies one validated V2 content mutation to a canonical V2 draft.
 *
 * Precondition order is fixed:
 * 1. `expectedVersion === draft.version` (version_conflict wins over every
 *    lower-level validation, exactly like the structural concurrent wrapper)
 * 2. confirmed guard (draft_confirmed)
 * 3. mutation-specific target/domain validation
 * 4. semantic no-op detection (returns the EXACT original reference, no bump)
 * 5. immutable domain change
 * 6. version bumped exactly once via `nextDraftVersion`
 * 7. `baseVersion` preserved
 * 8. final result validated with `validateDraftV2`
 *
 * Non-structural invariant: `result.structure === draft.structure` and
 * `result.sections === draft.sections` by reference.
 */
export function applyDraftContentMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftContentMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  switch (mutation.op) {
    case "set_value":
      return applySetValue(draft, mutation);
    case "clear_value":
      return applyClearValue(draft, mutation);
    case "set_field_label":
      return applySetFieldLabel(draft, mutation);
    case "set_field_type":
      return applySetFieldType(draft, mutation);
    case "lock_field":
      return applyLockField(draft, mutation);
    case "unlock_field":
      return applyUnlockField(draft, mutation);
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

function assertFieldExists(
  draft: CharacterSheetDraftV2,
  key: string,
): DraftField {
  const field = draft.fields.find((entry) => entry.key === key);
  if (field === undefined) {
    throw draftError(
      "surface_out_of_bounds",
      `Draft field "${key}" is outside the editable surface.`,
    );
  }
  return field;
}

function fieldReadLocked(field: DraftField): Error {
  return draftError(
    "field_read_locked",
    `Draft field "${field.key}" is read-locked; unlock it before editing.`,
  );
}

function applySetValue(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetValueMutationV2,
): CharacterSheetDraftV2 {
  const field = assertFieldExists(draft, mutation.key);
  if (field.locked) {
    throw fieldReadLocked(field);
  }
  if (mutation.value === null) {
    throw draftError(
      "invalid_mutation",
      "Use clear_value to blank a draft field.",
    );
  }
  if (field.key === "character_name" && typeof mutation.value !== "string") {
    throw draftError(
      "invalid_mutation",
      "The character_name value must be a string.",
    );
  }
  assertValueMatchesField(field, mutation.value);

  const current = draft.values[field.key];
  if (semanticallyEqualValues(current, mutation.value)) {
    return draft;
  }

  const values = { ...draft.values, [field.key]: mutation.value };
  const characterName = mirrorCharacterName(
    field.key,
    mutation.value,
    draft.characterName,
  );
  return commitV2(draft, { ...draft, values, characterName });
}

function applyClearValue(
  draft: CharacterSheetDraftV2,
  mutation: DraftClearValueMutationV2,
): CharacterSheetDraftV2 {
  const field = assertFieldExists(draft, mutation.key);
  if (field.locked) {
    throw fieldReadLocked(field);
  }
  if (draft.values[field.key] === undefined) {
    return draft;
  }
  const values = { ...draft.values };
  delete values[field.key];
  const characterName =
    field.key === "character_name" ? null : draft.characterName;
  return commitV2(draft, { ...draft, values, characterName });
}

function applySetFieldLabel(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetFieldLabelMutationV2,
): CharacterSheetDraftV2 {
  const field = assertFieldExists(draft, mutation.key);
  if (field.label === mutation.label) {
    return draft;
  }
  return commitV2(draft, {
    ...draft,
    fields: draft.fields.map((entry) =>
      entry.key === field.key ? { ...entry, label: mutation.label } : entry,
    ),
  });
}

function applySetFieldType(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetFieldTypeMutationV2,
): CharacterSheetDraftV2 {
  const current = assertFieldExists(draft, mutation.field.key);
  if (current.key === "character_name" && mutation.field.type !== "text") {
    throw draftError(
      "invalid_mutation",
      "The character_name field must stay a text field.",
    );
  }
  const replacement = fieldForTypeChangeV2(current, mutation);

  const currentValue = draft.values[current.key];
  const removesValue =
    currentValue !== undefined && !valueMatchesType(currentValue, replacement);

  if (fieldSemanticallyEqual(current, replacement) && !removesValue) {
    return draft;
  }

  const values = { ...draft.values };
  if (removesValue) {
    delete values[current.key];
  }
  const characterName =
    removesValue && current.key === "character_name"
      ? null
      : draft.characterName;
  return commitV2(draft, {
    ...draft,
    fields: draft.fields.map((entry) =>
      entry.key === current.key ? replacement : entry,
    ),
    values,
    characterName,
  });
}

function applyLockField(
  draft: CharacterSheetDraftV2,
  mutation: DraftLockFieldMutationV2,
): CharacterSheetDraftV2 {
  const field = assertFieldExists(draft, mutation.key);
  if (field.locked) {
    return draft;
  }
  return commitV2(draft, {
    ...draft,
    fields: draft.fields.map((entry) =>
      entry.key === field.key ? { ...entry, locked: true } : entry,
    ),
  });
}

function applyUnlockField(
  draft: CharacterSheetDraftV2,
  mutation: DraftUnlockFieldMutationV2,
): CharacterSheetDraftV2 {
  const field = assertFieldExists(draft, mutation.key);
  if (!field.locked) {
    return draft;
  }
  return commitV2(draft, {
    ...draft,
    fields: draft.fields.map((entry) =>
      entry.key === field.key ? { ...entry, locked: false } : entry,
    ),
  });
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

function fieldForTypeChangeV2(
  current: DraftField,
  mutation: DraftSetFieldTypeMutationV2,
): DraftField {
  const change = mutation.field;
  const base: DraftField = {
    key: current.key,
    label: current.label,
    type: change.type,
    locked: current.locked,
  };
  if (change.type === "choice") {
    if (change.options === undefined) {
      throw draftError(
        "invalid_mutation",
        "A choice field needs at least one option.",
      );
    }
    return { ...base, options: change.options };
  }
  if (change.type === "number") {
    if (
      change.min !== undefined &&
      change.max !== undefined &&
      change.min > change.max
    ) {
      throw draftError(
        "invalid_mutation",
        "The minimum cannot exceed the maximum.",
      );
    }
    return {
      ...base,
      ...(change.min === undefined ? {} : { min: change.min }),
      ...(change.max === undefined ? {} : { max: change.max }),
    };
  }
  return base;
}

function fieldSemanticallyEqual(a: DraftField, b: DraftField): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.locked === b.locked &&
    a.min === b.min &&
    a.max === b.max &&
    optionsEqual(a.options, b.options)
  );
}

function optionsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((option, index) => option === b[index]);
}

function semanticallyEqualValues(
  current: DraftValue | undefined,
  next: DraftValue,
): boolean {
  if (current === next) return true;
  if (Array.isArray(current) && Array.isArray(next)) {
    return (
      current.length === next.length &&
      current.every((item, index) => item === next[index])
    );
  }
  return false;
}

function valueMatchesType(value: DraftValue, field: DraftField): boolean {
  if (value === null) return true;
  if (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "choice"
  ) {
    return typeof value === "string";
  }
  if (field.type === "number") return typeof value === "number";
  if (field.type === "checkbox") return typeof value === "boolean";
  return Array.isArray(value);
}

function mirrorCharacterName(
  key: string,
  value: DraftValue,
  current: string | null,
): string | null {
  if (key !== "character_name") return current;
  return typeof value === "string" ? value : current;
}

function assertValueMatchesField(field: DraftField, value: DraftValue): void {
  switch (field.type) {
    case "text":
    case "textarea":
      if (typeof value !== "string") {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" expects a string value.`,
        );
      }
      return;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" expects a finite number.`,
        );
      }
      if (field.min !== undefined && value < field.min) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" must be at least ${field.min}.`,
        );
      }
      if (field.max !== undefined && value > field.max) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" must be at most ${field.max}.`,
        );
      }
      return;
    }
    case "checkbox":
      if (typeof value !== "boolean") {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" expects a boolean value.`,
        );
      }
      return;
    case "choice":
      if (typeof value !== "string" || !field.options?.includes(value)) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" expects a declared option.`,
        );
      }
      return;
    case "list":
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
      ) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${field.key}" expects a list of text items.`,
        );
      }
      return;
  }
}
