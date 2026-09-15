import { z } from "zod";
import { draftError } from "./errors";

export const CHARACTER_SHEET_DRAFT_VERSION = "1" as const;

/** A draft surface holds at most the generation pipeline's field budget. */
export const MAX_DRAFT_SURFACE_FIELDS = 192;
/** A draft may carry at most as many values as surface fields. */
export const MAX_DRAFT_VALUES_FIELDS = 192;
export const MAX_DRAFT_FIELD_KEY_CHARS = 128;
export const MAX_DRAFT_FIELD_LABEL_CHARS = 256;
export const MAX_DRAFT_TEXT_VALUE_CHARS = 2_000;
export const MAX_DRAFT_CHOICE_OPTIONS = 24;
export const MAX_DRAFT_CHOICE_OPTION_CHARS = 128;
export const MAX_DRAFT_SOURCE_ID_CHARS = 128;

/**
 * Draft keys are always generation canonical keys, which are also safe field
 * ids. Keeping them on the `FieldIdSchema` alphabet (letters, digits, `.`,
 * `_`, `:`, `-`) makes every draft key a valid `CharacterSheetSpec` field id
 * and a path-safe R2 segment at the same time, with no transformation.
 */
const draftKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Opaque, path-safe identity segment rules mirroring the artifact keys policy. */
const draftIdentitySchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      !value.includes("/") && !value.includes("\\") && !value.includes(".."),
    "Draft identities must be single path-safe segments.",
  );

export const DraftIdentitySchema = draftIdentitySchema;
export type DraftIdentity = z.infer<typeof DraftIdentitySchema>;

export const DraftFieldTypeSchema = z.enum([
  "text",
  "number",
  "textarea",
  "checkbox",
  "choice",
]);
export type DraftFieldType = z.infer<typeof DraftFieldTypeSchema>;

export const DraftValueSchema = z.union([
  z.string().max(MAX_DRAFT_TEXT_VALUE_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type DraftValue = z.infer<typeof DraftValueSchema>;

export const DraftFieldSchema = z
  .strictObject({
    key: z
      .string()
      .min(1)
      .max(MAX_DRAFT_FIELD_KEY_CHARS)
      .regex(draftKeyPattern, "Draft keys must use safe canonical keys."),
    label: z.string().min(1).max(MAX_DRAFT_FIELD_LABEL_CHARS).regex(/\S/),
    type: DraftFieldTypeSchema,
    locked: z.boolean(),
    options: z
      .array(z.string().min(1).max(MAX_DRAFT_CHOICE_OPTION_CHARS).regex(/\S/))
      .min(1)
      .max(MAX_DRAFT_CHOICE_OPTIONS)
      .optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .superRefine((field, context) => {
    if (field.type === "choice") {
      if (field.options === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A choice field must declare options.",
        });
      }
      if (field.min !== undefined || field.max !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A choice field cannot declare numeric bounds.",
        });
      }
    } else if (field.options !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only choice fields may declare options.",
      });
    }
    if (field.type === "number") {
      if (
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A number field min cannot exceed its max.",
        });
      }
    } else if (field.min !== undefined || field.max !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only number fields may declare numeric bounds.",
      });
    }
  });
export type DraftField = z.infer<typeof DraftFieldSchema>;

export const DraftSourceSchema = z.strictObject({
  sourceSheetId: z.string().max(MAX_DRAFT_SOURCE_ID_CHARS).nullable(),
  sourceRunId: z.string().max(MAX_DRAFT_SOURCE_ID_CHARS).nullable(),
});
export type DraftSource = z.infer<typeof DraftSourceSchema>;

/**
 * Serializable character-sheet draft snapshot. A draft is a bounded surface
 * model, never a full `CharacterSheetSpec`: it carries the editable field
 * roster, typed values, reroll ownership flags (read locks), and provenance
 * back to the generated run it was created from. `characterName` is a derived
 * display convenience and always equals `values["character_name"] ?? null`.
 */
export const CharacterSheetDraftSchema = z
  .strictObject({
    schemaVersion: z.literal(CHARACTER_SHEET_DRAFT_VERSION),
    draftId: DraftIdentitySchema,
    sessionId: DraftIdentitySchema,
    baseVersion: z.number().int().min(1),
    version: z.number().int().min(1),
    mode: z.enum(["pc", "npc"]),
    characterName: z.string().max(256).nullable(),
    rulesContextId: z.string().max(128).nullable(),
    fields: z.array(DraftFieldSchema).min(1).max(MAX_DRAFT_SURFACE_FIELDS),
    values: z
      .record(z.string(), DraftValueSchema)
      .superRefine((value, context) => {
        if (Object.keys(value).length > MAX_DRAFT_VALUES_FIELDS) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A draft may carry at most ${MAX_DRAFT_VALUES_FIELDS} values.`,
          });
        }
      }),
    source: DraftSourceSchema,
    confirmed: z.boolean().default(false),
  })
  .superRefine((draft, context) => {
    const keys = draft.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Draft field keys must be unique.",
      });
    }
    const fieldKeys = new Set(keys);
    for (const entry of Object.keys(draft.values)) {
      if (!fieldKeys.has(entry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Draft values reference unknown key "${entry}".`,
        });
      }
    }
    const nameValue =
      draft.values["character_name"] === undefined
        ? null
        : draft.values["character_name"];
    if (nameValue !== null && typeof nameValue !== "string") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The character_name value must be a string or null.",
      });
    } else if (draft.characterName !== nameValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "characterName must mirror the character_name value.",
      });
    }
  });
export type CharacterSheetDraft = z.infer<typeof CharacterSheetDraftSchema>;

/**
 * Parses untrusted input into a valid draft snapshot, enforcing every schema
 * bound above. Throws `DraftError("invalid_draft")` on rejection.
 */
export function validateDraft(value: unknown): CharacterSheetDraft {
  const result = CharacterSheetDraftSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_draft",
      first === undefined
        ? "The draft is invalid."
        : `The draft is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Policy record describing why every persisted draft version remains portable:
 * it is system-agnostic (no game system is embedded), every draft key is
 * bounded and safe, and the schema is the current serialization contract.
 */
export interface DraftForwardCompatibility {
  current: true;
  schemaVersion: typeof CHARACTER_SHEET_DRAFT_VERSION;
  systemAgnostic: true;
  allExportableSystems: true;
  boundedKeys: true;
}

export function draftForwardCompatibility(
  draft: CharacterSheetDraft,
): DraftForwardCompatibility {
  return {
    current: true,
    schemaVersion: draft.schemaVersion,
    systemAgnostic: true,
    allExportableSystems: true,
    boundedKeys: true,
  };
}
