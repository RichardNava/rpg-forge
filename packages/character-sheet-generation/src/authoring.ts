import { MAX_TOTAL_FIELDS } from "./model.js";
import { z } from "zod";

export const MAX_AUTHORING_CONTEXT_CHARS = 20_000;
export const MAX_AUTHORING_HISTORY_CHARS = 20_000;
export const MAX_AUTHORING_TRAIT_VALUE_CHARS = 5_000;
export const MAX_AUTHORING_UPLOAD_REF_CHARS = 1_024;

/**
 * Private authoring mode for sheet generation. The value space (pc/npc) is
 * intentionally distinct from the compiled CharacterSheetSpec mode (player/npc)
 * so the request contract never leaks into persistence.
 */
export const CharacterSheetAuthoringModeSchema = z.enum(["pc", "npc"]);
export type CharacterSheetAuthoringMode = z.infer<
  typeof CharacterSheetAuthoringModeSchema
>;

/** A user-authored field label. Bounded and non-blank like compiled labels. */
export const AuthoredFieldLabelSchema = z.string().min(1).max(200).regex(/\S/);
export type AuthoredFieldLabel = z.infer<typeof AuthoredFieldLabelSchema>;

/**
 * Optional character name. Supplied names are trimmed and preserved; blank
 * input becomes null, meaning "no preference" and symmetry with the rule that
 * the model must never be forced to invent identity from nothing.
 */
export const CharacterNameSchema = z
  .string()
  .max(256)
  .transform((value): string | null => {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .nullable();
export type CharacterName = z.infer<typeof CharacterNameSchema>;

/** BCP-47-ish locale with the same shape as the compiled metadata locale. */
export const OutputLocaleSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export type OutputLocale = z.infer<typeof OutputLocaleSchema>;

/**
 * Private visual-style key. It references a themed presentation only; by
 * contract it never influences mechanical values or field selection.
 */
export const VisualStyleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Visual style keys must be kebab-case.");
export type VisualStyleKey = z.infer<typeof VisualStyleKeySchema>;

/** A non-mechanical identity trait. Value is optional free text, never a stat. */
export const IdentityTraitInputSchema = z.strictObject({
  label: AuthoredFieldLabelSchema,
  value: z.string().max(MAX_AUTHORING_TRAIT_VALUE_CHARS).nullable().optional(),
});
export type IdentityTraitInput = z.infer<typeof IdentityTraitInputSchema>;

/** A numeric mechanical field with an optional starting value (PC). */
export const PCMechanicalFieldInputSchema = z.strictObject({
  label: AuthoredFieldLabelSchema,
  initialValue: z.number().finite().nullable().optional(),
});
export type PCMechanicalFieldInput = z.infer<
  typeof PCMechanicalFieldInputSchema
>;

/** A numeric mechanical field with an optional permitted range (NPC). */
export const NPCMechanicalFieldInputSchema = z
  .strictObject({
    label: AuthoredFieldLabelSchema,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .superRefine((field, context) => {
    if ((field.min === undefined) !== (field.max === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "NPC mechanical field min and max must be supplied together.",
      });
    } else if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message:
          "NPC mechanical field max must be greater than or equal to min.",
      });
    }
  });
export type NPCMechanicalFieldInput = z.infer<
  typeof NPCMechanicalFieldInputSchema
>;

/** A portrait is either an uploaded asset reference or a remote URL (PC only). */
export const PCPortraitInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("upload"),
    uploadRef: z
      .string()
      .min(1)
      .max(MAX_AUTHORING_UPLOAD_REF_CHARS)
      .regex(/\S/),
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().url(),
  }),
]);
export type PCPortraitInput = z.infer<typeof PCPortraitInputSchema>;

export const NPCDispositionSchema = z.enum(["ally", "enemy"]);
export type NPCDisposition = z.infer<typeof NPCDispositionSchema>;

export const NPCThreatLevelSchema = z.enum([
  "weak",
  "ordinary",
  "dangerous",
  "elite",
  "boss",
]);
export type NPCThreatLevel = z.infer<typeof NPCThreatLevelSchema>;

function rejectDuplicateLabels<T extends { label: string }>(
  entries: T[],
  context: z.RefinementCtx,
  kind: string,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.label)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [String(index), "label"],
        message: `${kind} label "${entry.label}" repeats.`,
      });
    }
    seen.add(entry.label);
  });
}

const identityTraitInputsSchema = z
  .array(IdentityTraitInputSchema)
  .max(MAX_TOTAL_FIELDS)
  .default([])
  .superRefine((traits, context) =>
    rejectDuplicateLabels(traits, context, "Identity trait"),
  );

const pcMechanicalFieldInputsSchema = z
  .array(PCMechanicalFieldInputSchema)
  .max(MAX_TOTAL_FIELDS)
  .default([])
  .superRefine((fields, context) =>
    rejectDuplicateLabels(fields, context, "Mechanical field"),
  );

const npcMechanicalFieldInputsSchema = z
  .array(NPCMechanicalFieldInputSchema)
  .max(MAX_TOTAL_FIELDS)
  .default([])
  .superRefine((fields, context) =>
    rejectDuplicateLabels(fields, context, "Mechanical field"),
  );

const commonAuthoringFields = {
  characterName: CharacterNameSchema.optional(),
  contextInstructions: z
    .string()
    .max(MAX_AUTHORING_CONTEXT_CHARS)
    .regex(/\S/)
    .optional(),
  outputLocale: OutputLocaleSchema.optional(),
  visualStyle: VisualStyleKeySchema.optional(),
  identityTraits: identityTraitInputsSchema,
} as const;

export const PCGenerationRequestSchema = z.strictObject({
  ...commonAuthoringFields,
  mode: z.literal("pc"),
  mechanicalFields: pcMechanicalFieldInputsSchema,
  portrait: PCPortraitInputSchema.optional(),
  history: z.string().max(MAX_AUTHORING_HISTORY_CHARS).regex(/\S/).optional(),
});
export type PCGenerationRequest = z.infer<typeof PCGenerationRequestSchema>;

export const NPCGenerationRequestSchema = z
  .strictObject({
    ...commonAuthoringFields,
    mode: z.literal("npc"),
    mechanicalFields: npcMechanicalFieldInputsSchema,
    disposition: NPCDispositionSchema,
    threat: NPCThreatLevelSchema.optional(),
  })
  .superRefine((body, context) => {
    if (body.disposition === "enemy" && body.threat === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threat"],
        message: "An enemy NPC requires a threat level.",
      });
    }
    if (body.disposition === "ally" && body.threat !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threat"],
        message: "An ally NPC must not define a threat level.",
      });
    }
  });
export type NPCGenerationRequest = z.infer<typeof NPCGenerationRequestSchema>;

export const CharacterSheetGenerationRequestSchema = z.discriminatedUnion(
  "mode",
  [PCGenerationRequestSchema, NPCGenerationRequestSchema],
);
export type CharacterSheetGenerationRequest = z.infer<
  typeof CharacterSheetGenerationRequestSchema
>;
