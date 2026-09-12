import { CharacterSheetSpecSchema } from "@repo/character-sheet-schema";
import { RulesContextSchema } from "@repo/rules-context";
import { z } from "zod";
import {
  SHEET_GENERATION_INPUT_ARTIFACT_VERSION,
  SHEET_GENERATION_SPEC_ARTIFACT_VERSION,
} from "./model.js";

/**
 * The generation input artifact persisted as a temporary object (R2), never in
 * D1. It carries the canonical READY RulesContext the sheet is derived from so
 * every later stage is self-contained and versioned.
 */
export const SheetGenerationInputArtifactSchema = z.strictObject({
  version: z.literal(SHEET_GENERATION_INPUT_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  rulesAnalysisRunId: z.uuid(),
  ingestionId: z.uuid(),
  context: RulesContextSchema,
});
export type SheetGenerationInputArtifact = z.infer<
  typeof SheetGenerationInputArtifactSchema
>;

/**
 * The final compiled canonical spec artifact. The compiler owns the full
 * CharacterSheetSpec contract; readers never re-validate beyond this schema.
 */
export const SheetGenerationSpecArtifactSchema = z.strictObject({
  version: z.literal(SHEET_GENERATION_SPEC_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  spec: CharacterSheetSpecSchema,
});
export type SheetGenerationSpecArtifact = z.infer<
  typeof SheetGenerationSpecArtifactSchema
>;
