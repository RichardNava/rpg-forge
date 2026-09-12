import { z } from "zod";
import {
  CharacterNameSchema,
  CharacterSheetAuthoringModeSchema,
  type CharacterSheetGenerationRequest,
  MAX_AUTHORING_CONTEXT_CHARS,
  MAX_AUTHORING_HISTORY_CHARS,
  OutputLocaleSchema,
  PCPortraitInputSchema,
  VisualStyleKeySchema,
} from "./authoring.js";
import { MAX_TOTAL_FIELDS } from "./model.js";
import {
  canonicalizeFieldLabel,
  NPCAuthoringDefinitionSchema,
  SourceResolvedFieldSchema,
  type SheetFieldSourceProvenance,
  type SourceResolvedField,
} from "./source-resolution.js";

/**
 * Deterministically normalized view of a validated GUI authoring request.
 * Characterization is preserved exactly (explicit name, explicit open intent
 * as null) and no value is invented: PC blank stays blank, NPC fields carry
 * their permitted range and never an explicit generated value, identity traits
 * keep their free text. contextInstructions remains unused raw request state;
 * visualStyle and outputLocale stay plain generation metadata. This is the
 * GUI source side of source resolution, not the final generation definition.
 */
export const NormalizedGuiSourceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: CharacterSheetAuthoringModeSchema,
  characterName: CharacterNameSchema.nullable(),
  fields: z.array(SourceResolvedFieldSchema).max(MAX_TOTAL_FIELDS),
  npc: NPCAuthoringDefinitionSchema.optional(),
  contextInstructions: z.string().max(MAX_AUTHORING_CONTEXT_CHARS).optional(),
  outputLocale: OutputLocaleSchema.optional(),
  visualStyle: VisualStyleKeySchema.optional(),
  portrait: PCPortraitInputSchema.optional(),
  history: z.string().max(MAX_AUTHORING_HISTORY_CHARS).optional(),
});
export type NormalizedGuiSource = z.infer<typeof NormalizedGuiSourceSchema>;

const guiProvenance: SheetFieldSourceProvenance = { origins: ["gui"] };

function normalizeMechanicalField(
  label: string,
  initialValue: number | null | undefined,
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    explicitValue: initialValue ?? null,
    provenance: guiProvenance,
  };
}

function normalizeNpcMechanicalField(
  label: string,
  range: { min: number; max: number } | undefined,
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    ...(range !== undefined ? { permittedValueRange: range } : {}),
    provenance: guiProvenance,
  };
}

function normalizeIdentityTrait(
  label: string,
  value: string | null | undefined,
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "identity",
    explicitValue: value ?? null,
    provenance: guiProvenance,
  };
}

/**
 * Maps a validated GUI authoring request onto normalized SourceResolvedFields
 * plus the request state later phases need. Mechanical fields keep authoring
 * order, then identity traits keep authoring order. No interpretation of
 * contextInstructions and no AI anywhere: the output is pure deterministic
 * normalization of already-validated input.
 */
export function normalizeGuiSource(
  request: CharacterSheetGenerationRequest,
): NormalizedGuiSource {
  const fields: SourceResolvedField[] = [];

  if (request.mode === "pc") {
    for (const mechanical of request.mechanicalFields) {
      fields.push(
        normalizeMechanicalField(mechanical.label, mechanical.initialValue),
      );
    }
    for (const trait of request.identityTraits) {
      fields.push(normalizeIdentityTrait(trait.label, trait.value));
    }
  } else {
    for (const mechanical of request.mechanicalFields) {
      const { min, max } = mechanical;
      fields.push(
        normalizeNpcMechanicalField(
          mechanical.label,
          min !== undefined && max !== undefined ? { min, max } : undefined,
        ),
      );
    }
    for (const trait of request.identityTraits) {
      fields.push(normalizeIdentityTrait(trait.label, trait.value));
    }
  }

  const normalized: NormalizedGuiSource = NormalizedGuiSourceSchema.parse({
    schemaVersion: 1,
    mode: request.mode,
    characterName: request.characterName ?? null,
    fields,
    ...(request.mode === "npc"
      ? {
          npc: {
            disposition: request.disposition,
            threat: request.threat ?? null,
          },
        }
      : {}),
    ...(request.contextInstructions !== undefined
      ? { contextInstructions: request.contextInstructions }
      : {}),
    ...(request.outputLocale !== undefined
      ? { outputLocale: request.outputLocale }
      : {}),
    ...(request.visualStyle !== undefined
      ? { visualStyle: request.visualStyle }
      : {}),
    ...(request.mode === "pc" && request.portrait !== undefined
      ? { portrait: request.portrait }
      : {}),
    ...(request.mode === "pc" && request.history !== undefined
      ? { history: request.history }
      : {}),
  });

  return normalized;
}
