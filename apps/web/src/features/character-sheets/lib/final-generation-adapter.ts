import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import {
  buildFinalGenerationRequestV1,
  type FinalGenerationRequestV1,
  type CanonicalVisualStyle,
  type ThreatLevel,
  type PortraitConfig,
} from "@repo/character-sheet-generation";
import type { ThreatLevelPreference, VisualStyleKey } from "../state/sheet-workshop-types";

/**
 * Web adapter for final generation (Phase 14.11).
 *
 * In Phase 14.11, final generation is request contract only — no AI/PDF
 * execution. This adapter prepares the canonical FinalGenerationRequestV1
 * from a confirmed Draft + workshop options. The actual generation endpoint
 * will be implemented in a later phase (14.12+).
 */
export function buildFinalGenerationRequestFromDraft(
  draft: CharacterSheetDraftV2,
  options: {
    threat?: ThreatLevelPreference | null;
    visualStyle?: VisualStyleKey | null;
    instructions?: string | null;
    portrait?: PortraitConfig;
    seed: string;
  },
): FinalGenerationRequestV1 {
  return buildFinalGenerationRequestV1(draft, options);
}

/**
 * Validates that a draft is eligible for final generation.
 * @throws if draft is not confirmed
 * @throws if PC draft has threat option
 * @throws if NPC draft lacks threat option
 */
export function assertFinalGenerationEligible(
  draft: CharacterSheetDraftV2,
  threat?: ThreatLevelPreference | null,
): void {
  if (!draft.confirmed) {
    throw new Error("Draft must be confirmed before final generation.");
  }
  if (draft.mode === "pc" && threat) {
    throw new Error("PC draft cannot have threat.");
  }
  if (draft.mode === "npc" && !threat) {
    throw new Error("NPC draft requires threat.");
  }
}