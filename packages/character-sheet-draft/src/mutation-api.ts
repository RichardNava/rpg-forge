import { z } from "zod";
import type {
  CharacterSheetDraft,
  DraftField,
  DraftValue,
} from "./draft-schema.js";
import { DraftValueSchema, MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema.js";
import { draftError } from "./errors.js";
import { assertDraftFieldExists } from "./guided-edit.js";

export const DraftMutationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set_value"),
    key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS),
    value: DraftValueSchema,
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
  const mutation = parseDraftMutation(mutationInput);
  const field = assertDraftFieldExists(draft, mutation.key);

  switch (mutation.op) {
    case "set_value": {
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
    case "lock_field":
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === field.key ? { ...entry, locked: true } : entry,
        ),
      };
    case "unlock_field":
      return {
        ...draft,
        fields: draft.fields.map((entry) =>
          entry.key === field.key ? { ...entry, locked: false } : entry,
        ),
      };
  }
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
