import { z } from "zod";
import { CharacterSheetDraftV2Schema } from "@repo/character-sheet-draft";
import { NPCThreatLevelSchema } from "./authoring.js";

/**
 * Canonical five-level threat schema (14.11).
 * Machine keys are stable identifiers; UI labels are for display only.
 */
export const ThreatLevelSchema = NPCThreatLevelSchema;
export type ThreatLevel = z.infer<typeof ThreatLevelSchema>;

/** Human-readable labels for the canonical threat levels. */
export const THREAT_LABELS: Record<string, string> = {
  "very-low": "Very low",
  low: "Low",
  medium: "Medium",
  elite: "Elite",
  legendary: "Legendary",
} as const;

/**
 * Canonical visual style enum (14.11).
 * Exact six values from the generation package's authoring contract.
 */
export const CanonicalVisualStyleSchema = z.enum([
  "medieval",
  "fantasy",
  "gothic",
  "steampunk",
  "sci-fi",
  "contemporary",
]);
export type CanonicalVisualStyle = z.infer<typeof CanonicalVisualStyleSchema>;

/** Human-readable labels for the canonical visual styles. */
export const CANONICAL_VISUAL_STYLE_LABELS: Record<CanonicalVisualStyle, string> = {
  medieval: "Medieval",
  fantasy: "Fantasy",
  gothic: "Gothic",
  steampunk: "Steampunk",
  "sci-fi": "Sci-fi",
  contemporary: "Contemporary",
} as const;

/**
 * Portrait configuration boundary (14.11 boundary, 14.13 implementation).
 * For 14.11, only `none` is valid. Future phases will extend this.
 */
export const PortraitConfigSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
]);
export type PortraitConfig = z.infer<typeof PortraitConfigSchema>;

/**
 * User instructions for final generation (bounded, optional).
 */
export const InstructionsSchema = z.string().max(5000).nullable().optional();
export type Instructions = z.infer<typeof InstructionsSchema>;

/**
 * Canonical final generation request — carries confirmed Draft + options.
 * This is the single canonical request contract for final generation (14.11).
 */
export const FinalGenerationRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  draft: z.any(), // CharacterSheetDraftV2 - using z.any() to avoid circular deps
  options: z.strictObject({
    threat: ThreatLevelSchema.nullish(),
    visualStyle: CanonicalVisualStyleSchema.nullish(),
    instructions: InstructionsSchema,
    portrait: PortraitConfigSchema,
  }).strict(),
  seed: z.string().min(1).max(64),
});
export type FinalGenerationRequestV1 = z.infer<typeof FinalGenerationRequestV1Schema>;

/**
 * Builds the canonical final generation request from a confirmed Draft + options.
 * @throws if draft.confirmed !== true
 * @throws if PC draft has threat option
 * @throws if NPC draft lacks threat option
 */
export function buildFinalGenerationRequestV1(
  draft: any, // CharacterSheetDraftV2
  options: {
    threat?: ThreatLevel | null;
    visualStyle?: CanonicalVisualStyle | null;
    instructions?: string | null;
    portrait?: PortraitConfig;
    seed: string;
  },
): FinalGenerationRequestV1 {
  // Validate preconditions
  if (!draft.confirmed) {
    throw new Error("Draft must be confirmed");
  }
  if (draft.mode === "pc" && options.threat) {
    throw new Error("PC draft cannot have threat");
  }
  if (draft.mode === "npc" && !options.threat) {
    throw new Error("NPC draft requires threat");
  }

  // Build the request preserving all Draft content exactly
  const threatOption = draft.mode === "npc" ? options.threat : null;
  return {
    schemaVersion: "1",
    draft: {
      ...draft,
      // Ensure threat is not persisted in the draft for final generation
      // Threat is carried only in options
    },
    options: {
      threat: threatOption,
      visualStyle: options.visualStyle ?? null,
      instructions: options.instructions ?? null,
      portrait: options.portrait ?? { kind: "none" as const },
    },
    seed: options.seed,
  };
}

/**
 * Validates a FinalGenerationRequestV1 without building it.
 * Returns parsed request or throws.
 */
export function validateFinalGenerationRequestV1(input: unknown) {
  return FinalGenerationRequestV1Schema.parse(input);
}