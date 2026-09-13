import { z } from "zod";
import {
  type CharacterName,
  type CharacterSheetAuthoringMode,
} from "./authoring.js";
import {
  applyGenerationInstructions,
  GenerationInstructionApplicationResultSchema,
  type ProposedGenerationInstruction,
} from "./instructions.js";
import {
  resolveSources,
  SourceResolutionResultSchema,
  type SourceResolutionResult,
} from "./source-merge.js";
import {
  MAX_GENERATION_CONFLICTS,
  NormalizedSheetDefinitionSchema,
  type GenerationConflict,
  type NPCAuthoringDefinition,
  type NormalizedSheetDefinition,
  type SourceResolvedField,
} from "./source-resolution.js";

export interface UnifiedSheetGenerationInput {
  mode: CharacterSheetAuthoringMode;
  characterName?: CharacterName | null;
  npc?: NPCAuthoringDefinition;
  guiFields?: readonly SourceResolvedField[];
  rulebookFields?: readonly SourceResolvedField[];
  /** Logical section grouping (template-backed flow); empty for rulebook/GUI flows. */
  sections?: NormalizedSheetDefinition["sections"];
  /** Evidence-rejection/source conflicts recorded below Level-2 resolution. */
  sourceConflicts?: readonly GenerationConflict[];
  instructions?: readonly ProposedGenerationInstruction[];
}

/**
 * Unified result of 2D resolution. `sourceResolution` is the Level-2 merged
 * field set; `instructionResult` is the Level-1 application on top of it; the
 * final `definition` is exactly `instructionResult.definition`.
 */
export const UnifiedSheetGenerationResultSchema = z.strictObject({
  definition: NormalizedSheetDefinitionSchema,
  sourceResolution: SourceResolutionResultSchema,
  instructionResult: GenerationInstructionApplicationResultSchema,
});
export type UnifiedSheetGenerationResult = z.infer<
  typeof UnifiedSheetGenerationResultSchema
>;

/**
 * Deterministic 2D orchestration. Level-2 source resolution runs first
 * (GUI fields in authoring order, exact rulebook duplicates merging at the GUI
 * position, rulebook-only fields appending in derivation order, Vigor never
 * merging with Constitution), then the structured Level-1 instruction sequence
 * applies on top. sourceConflicts (for example fabricated-evidence rejections
 * from rulebook derivation) surface before the source-resolution conflicts.
 */
export function resolveUnifiedSheetDefinition(
  input: UnifiedSheetGenerationInput,
): UnifiedSheetGenerationResult {
  const sourceResolution: SourceResolutionResult = resolveSources({
    gui: input.guiFields ?? [],
    rulebook: input.rulebookFields ?? [],
  });

  const level2Conflicts = [
    ...(input.sourceConflicts ?? []),
    ...sourceResolution.conflicts,
  ].slice(0, MAX_GENERATION_CONFLICTS);

  const baseDefinition = NormalizedSheetDefinitionSchema.parse({
    schemaVersion: 1,
    mode: input.mode,
    characterName: input.characterName ?? null,
    fields: sourceResolution.fields,
    sections: input.sections ?? [],
    conflicts: level2Conflicts,
    ...(input.npc !== undefined ? { npc: input.npc } : {}),
  });

  const instructionResult = applyGenerationInstructions(
    baseDefinition,
    input.instructions ?? [],
  );

  return UnifiedSheetGenerationResultSchema.parse({
    definition: instructionResult.definition,
    sourceResolution,
    instructionResult,
  });
}
