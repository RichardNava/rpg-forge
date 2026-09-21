import { z } from "zod";
import type {
  CharacterSheetDraft,
  DraftField,
  DraftFieldType,
  DraftSection,
  DraftValue,
} from "./draft-schema";
import {
  DraftFieldSchema,
  DraftSectionSchema,
  DraftValueSchema,
  MAX_DRAFT_FIELD_KEY_CHARS,
  MAX_DRAFT_SURFACE_FIELDS,
} from "./draft-schema";
import { draftError } from "./errors";
import { assertDraftEditable } from "./finalize";
import { assertDraftFieldExists } from "./guided-edit";

export const DraftAddFieldSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(MAX_DRAFT_FIELD_KEY_CHARS)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
      "Field keys must use safe canonical keys.",
    ),
  label: z.string().min(1).max(256).regex(/\S/),
  type: z.enum(["text", "number", "textarea", "checkbox", "choice", "list"]),
  locked: z.boolean().default(false),
  options: z
    .array(z.string().min(1).max(128).regex(/\S/))
    .min(1)
    .max(24)
    .optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});
export type DraftAddField = z.infer<typeof DraftAddFieldSchema>;

const DraftFieldTypeChangeSchema = z.strictObject({
  key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
  type: z.enum(["text", "number", "textarea", "checkbox", "choice", "list"]),
  options: z
    .array(z.string().min(1).max(128).regex(/\S/))
    .min(1)
    .max(24)
    .optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});

export const DraftMutationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set_value"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    value: DraftValueSchema,
  }),
  z.strictObject({
    op: z.literal("set_field_label"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    label: z.string().min(1).max(256).regex(/\S/),
  }),
  z.strictObject({
    op: z.literal("set_field_type"),
    field: DraftFieldTypeChangeSchema,
  }),
  z.strictObject({ op: z.literal("add_section"), section: DraftSectionSchema }),
  z.strictObject({
    op: z.literal("rename_section"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    title: z.string().min(1).max(256).regex(/\S/),
  }),
  z.strictObject({
    op: z.literal("move_field"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    sectionKey: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS).nullable(),
  }),
  z.strictObject({
    op: z.literal("reparent_section"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    parentKey: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS).nullable(),
  }),
  z.strictObject({
    op: z.literal("clear_value"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
  }),
  z.strictObject({
    op: z.literal("lock_field"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
  }),
  z.strictObject({
    op: z.literal("unlock_field"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
  }),
  z.strictObject({
    op: z.literal("add_field"),
    field: DraftAddFieldSchema,
  }),
  z.strictObject({
    op: z.literal("remove_field"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
  }),
]);
export type DraftMutation = z.infer<typeof DraftMutationSchema>;

/**
 * Applies one typed mutation to an immutable draft snapshot and returns the
 * next snapshot. The mutation never mutates the input. The `characterName`
 * display convenience stays mirrored to `values["character_name"]`; a locked
 * field is read-only until the client explicitly unlocks it.
 */
export function applyDraftMutation(
  draft: CharacterSheetDraft,
  mutationInput: unknown,
): CharacterSheetDraft {
  assertDraftEditable(draft);
  const mutation = parseDraftMutation(mutationInput);

  switch (mutation.op) {
    case "set_value": {
      const field = assertDraftFieldExists(draft, mutation.key);
      if (field.locked) {
        throw draftError(
          "field_read_locked",
          `Draft field "${field.key}" is read-locked; unlock it before editing.`,
        );
      }
      assertValueMatchesField(field, mutation.value);
      const values = { ...draft.values, [field.key]: mutation.value };
      return {
        ...draft,
        values,
        characterName: mirrorCharacterName(
          field,
          mutation.value,
          draft.characterName,
        ),
      };
    }
    case "clear_value": {
      const field = assertDraftFieldExists(draft, mutation.key);
      if (field.locked) {
        throw draftError(
          "field_read_locked",
          `Draft field "${field.key}" is read-locked; unlock it before clearing.`,
        );
      }
      const values = { ...draft.values };
      delete values[field.key];
      return {
        ...draft,
        values,
        characterName:
          field.key === "character_name" ? null : draft.characterName,
      };
    }
    case "set_field_label": {
      const field = assertDraftFieldExists(draft, mutation.key);
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === field.key ? { ...entry, label: mutation.label } : entry,
        ),
      };
    }
    case "set_field_type": {
      const current = assertDraftFieldExists(draft, mutation.field.key);
      const replacement = fieldForTypeChange(current, mutation.field);
      const values = { ...draft.values };
      const currentValue = values[current.key];
      if (
        currentValue !== undefined &&
        !valueMatchesType(currentValue, replacement)
      ) {
        delete values[current.key];
      }
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === current.key ? replacement : entry,
        ),
        values,
      };
    }
    case "add_section": {
      const sections = draft.sections ?? [];
      if (sections.some((section) => section.key === mutation.section.key)) {
        throw draftError(
          "invalid_mutation",
          `Draft section "${mutation.section.key}" already exists.`,
        );
      }
      return { ...draft, sections: [...sections, mutation.section] };
    }
    case "rename_section": {
      const sections = draft.sections ?? [];
      if (!sections.some((section) => section.key === mutation.key)) {
        throw draftError(
          "invalid_mutation",
          `Draft section "${mutation.key}" does not exist.`,
        );
      }
      return {
        ...draft,
        sections: sections.map((section) =>
          section.key === mutation.key
            ? { ...section, title: mutation.title }
            : section,
        ),
      };
    }
    case "move_field": {
      const field = assertDraftFieldExists(draft, mutation.key);
      const sections = draft.sections ?? [];
      if (
        mutation.sectionKey !== null &&
        !sections.some((section) => section.key === mutation.sectionKey)
      ) {
        throw draftError(
          "invalid_mutation",
          `Draft section "${mutation.sectionKey}" does not exist.`,
        );
      }
      return {
        ...draft,
        sections: sections.map((section) => ({
          ...section,
          fieldKeys:
            section.key === mutation.sectionKey
              ? [
                  ...section.fieldKeys.filter((key) => key !== field.key),
                  field.key,
                ]
              : section.fieldKeys.filter((key) => key !== field.key),
        })),
      };
    }
    case "reparent_section": {
      const sections = draft.sections ?? [];
      if (!sections.some((section) => section.key === mutation.key)) {
        throw draftError(
          "invalid_mutation",
          `Draft section "${mutation.key}" does not exist.`,
        );
      }
      if (
        mutation.parentKey !== null &&
        !sections.some((section) => section.key === mutation.parentKey)
      ) {
        throw draftError(
          "invalid_mutation",
          `Draft section "${mutation.parentKey}" does not exist.`,
        );
      }
      return {
        ...draft,
        sections: sections.map((section) => {
          if (section.key !== mutation.key) return section;
          if (mutation.parentKey === null) {
            const { parentKey: _parentKey, ...rootSection } = section;
            return rootSection;
          }
          return { ...section, parentKey: mutation.parentKey };
        }),
      };
    }
    case "lock_field": {
      const field = assertDraftFieldExists(draft, mutation.key);
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === field.key ? { ...entry, locked: true } : entry,
        ),
      };
    }
    case "unlock_field": {
      const field = assertDraftFieldExists(draft, mutation.key);
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === field.key ? { ...entry, locked: false } : entry,
        ),
      };
    }
    case "add_field": {
      const existing = draft.fields.some(
        (entry) => entry.key === mutation.field.key,
      );
      if (existing) {
        throw draftError(
          "invalid_mutation",
          `Draft field "${mutation.field.key}" already exists.`,
        );
      }
      if (draft.fields.length >= MAX_DRAFT_SURFACE_FIELDS) {
        throw draftError(
          "surface_out_of_bounds",
          `A draft surface may contain at most ${MAX_DRAFT_SURFACE_FIELDS} fields.`,
        );
      }
      const field = validateAddField(mutation.field);
      return {
        ...draft,
        fields: [...draft.fields, field],
      };
    }
    case "remove_field": {
      const field = assertDraftFieldExists(draft, mutation.key);
      if (draft.fields.length <= 1) {
        throw draftError(
          "surface_out_of_bounds",
          "A draft must retain at least one field.",
        );
      }
      const fields = draft.fields.filter((entry) => entry.key !== field.key);
      const values = { ...draft.values };
      delete values[field.key];
      return {
        ...draft,
        fields,
        sections: (draft.sections ?? []).map((section) => ({
          ...section,
          fieldKeys: section.fieldKeys.filter((key) => key !== field.key),
        })),
        values,
        characterName:
          field.key === "character_name" ? null : draft.characterName,
      };
    }
  }
}

function fieldForTypeChange(
  field: DraftField,
  change: z.infer<typeof DraftFieldTypeChangeSchema>,
): DraftField {
  const base = {
    key: field.key,
    label: field.label,
    type: change.type,
    locked: field.locked,
  } as const;
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

function valueMatchesType(value: DraftValue, field: DraftField): boolean {
  if (value === null) return true;
  if (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "choice"
  )
    return typeof value === "string";
  if (field.type === "number") return typeof value === "number";
  if (field.type === "checkbox") return typeof value === "boolean";
  return Array.isArray(value);
}

function parseDraftMutation(input: unknown): DraftMutation {
  const result = DraftMutationSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The mutation is invalid."
        : `The mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

function validateAddField(input: DraftAddField): DraftField {
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

function assertValueMatchesField(field: DraftField, value: DraftValue): void {
  if (value === null) {
    throw draftError(
      "invalid_mutation",
      "Use clear_value to blank a draft field.",
    );
  }
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

function mirrorCharacterName(
  field: DraftField,
  value: DraftValue,
  current: string | null,
): string | null {
  if (field.key !== "character_name") {
    return current;
  }
  return typeof value === "string" ? value : current;
}
