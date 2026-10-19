import { z } from "zod";
import { CharacterSheetDraftV2Schema } from "@repo/character-sheet-draft";
import { PortraitAssetIdSchema } from "@repo/character-sheet-portraits";
import { NPCThreatLevelSchema } from "./authoring.ts";
import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";

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
 * Portrait configuration (14.13).
 *
 * Exactly one source is active by construction. Asset-backed sources carry
 * only the server-minted temporary `assetId` — never raw bytes, base64,
 * dataUrls, remote URLs, or AI prompts. The asset itself lives in the
 * temporary session portrait-asset layer and is revalidated server-side.
 */
export const PortraitConfigSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("upload"), assetId: PortraitAssetIdSchema }),
  z.strictObject({ kind: z.literal("url"), assetId: PortraitAssetIdSchema }),
  z.strictObject({ kind: z.literal("ai"), assetId: PortraitAssetIdSchema }),
]);
export type PortraitConfig = z.infer<typeof PortraitConfigSchema>;

/**
 * User instructions for final generation (bounded, optional).
 * Presentation guidance only — it never changes field values.
 */
export const InstructionsSchema = z.string().max(5000).nullable().optional();
export type Instructions = z.infer<typeof InstructionsSchema>;

/**
 * NPC content/value authoring instructions (bounded, optional, 14.14).
 *
 * Separate authority from `instructions`: these orient AI-generated VALUES
 * for eligible blank NPC fields (explicit user values always win; threat and
 * deterministic defaults apply only where instructions do not specify
 * enough). PC requests must carry null/absent (enforced below).
 */
export const NpcInstructionsSchema = z.string().max(5000).nullable().optional();
export type NpcInstructions = z.infer<typeof NpcInstructionsSchema>;

/**
 * Canonical final generation request — carries confirmed Draft + options.
 * This is the single canonical request contract for final generation (14.11).
 * Validates: confirmed draft, PC threat null, NPC threat required, visualStyle required.
 */
export const FinalGenerationRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  draft: CharacterSheetDraftV2Schema,
  options: z.strictObject({
    threat: ThreatLevelSchema.nullish(),
    visualStyle: CanonicalVisualStyleSchema,
    instructions: InstructionsSchema,
    npcInstructions: NpcInstructionsSchema,
    portrait: PortraitConfigSchema,
  }).strict(),
  seed: z.string().min(1).max(64),
}).superRefine((request, ctx) => {
  const { draft, options } = request;
  if (!draft.confirmed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["draft", "confirmed"],
      message: "Draft must be confirmed for final generation",
    });
  }
  if (draft.mode === "pc" && options.threat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options", "threat"],
      message: "PC draft cannot have threat",
    });
  }
  if (draft.mode === "npc" && !options.threat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options", "threat"],
      message: "NPC draft requires threat",
    });
  }
  if (draft.mode === "pc" && options.npcInstructions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options", "npcInstructions"],
      message: "PC draft cannot have NPC authoring instructions",
    });
  }
});
export type FinalGenerationRequestV1 = z.infer<typeof FinalGenerationRequestV1Schema>;

/**
 * Builds the canonical final generation request from a confirmed Draft + options.
 * @throws if draft.confirmed !== true
 * @throws if PC draft has threat option
 * @throws if NPC draft lacks threat option
 * @throws if PC draft has NPC authoring instructions
 */
export function buildFinalGenerationRequestV1(
  draft: CharacterSheetDraftV2,
  options: {
    threat?: ThreatLevel | null;
    visualStyle: CanonicalVisualStyle;
    instructions?: string | null;
    npcInstructions?: string | null;
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
  // Whitespace-only NPC instructions normalize to null; any remaining
  // non-null value on a PC draft is rejected (no silent content authority).
  const npcInstructions =
    options.npcInstructions === undefined || options.npcInstructions === null
      ? null
      : options.npcInstructions.trim() === ""
        ? null
        : options.npcInstructions.slice(0, 5000);
  if (draft.mode === "pc" && npcInstructions !== null) {
    throw new Error("PC draft cannot have NPC authoring instructions");
  }

  // Build the request preserving all Draft content exactly
  const threatOption = draft.mode === "npc" ? options.threat : null;
  return {
    schemaVersion: "1",
    draft: { ...draft },
    options: {
      threat: threatOption,
      visualStyle: options.visualStyle,
      instructions: options.instructions ?? null,
      npcInstructions,
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