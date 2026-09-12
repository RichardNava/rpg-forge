import { z } from "zod";

export const CHARACTER_SHEET_GENERATION_VERSION = 1;
export const SHEET_GENERATION_INPUT_ARTIFACT_VERSION = 1;
export const SHEET_GENERATION_SECTION_PLAN_ARTIFACT_VERSION = 1;
export const SHEET_GENERATION_FIELDS_ARTIFACT_VERSION = 1;
export const SHEET_GENERATION_CALCULATIONS_ARTIFACT_VERSION = 1;
export const SHEET_GENERATION_SPEC_ARTIFACT_VERSION = 1;

/** Bounds enforced on every generation stage so a run stays bounded and cheap. */
export const MAX_PLAN_SECTIONS = 12;
export const MAX_FIELDS_PER_SECTION = 48;
export const MAX_TOTAL_FIELDS = 192;
export const MAX_OPTIONS_PER_CHOICE = 24;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_CALCULATIONS = 32;
export const MAX_CALC_AST_DEPTH = 6;
export const MAX_REFERENCED_RULES_PER_SECTION = 32;
export const MAX_REFERENCED_RULES_PER_FIELD = 24;
export const MAX_PROMPT_CONTEXT_CHARS = 16_000;
export const MAX_PROMPT_SECTION_RULES_CHARS = 6_000;

/** One bounded correction replay per stage, matching the rules-analysis gate. */
export const SHEET_GENERATION_RETRIES = 2;

/** Maximum number of proposed instructions the extraction pipeline will emit. */
export const MAX_EXTRACTED_INSTRUCTIONS = 64;
/** Maximum number of pipeline diagnostics attached to one extraction result. */
export const MAX_EXTRACTION_DIAGNOSTICS = 16;
/** Cap on the human-readable detail text of one extraction diagnostic. */
export const MAX_EXTRACTION_DIAGNOSTIC_DETAIL_CHARS = 256;

export const SHEET_GENERATION_RUN_STATUSES = [
  "QUEUED",
  "GENERATING",
  "COMPILING",
  "READY",
  "FAILED",
  "INVALIDATED",
] as const;

export const SheetGenerationRunStatusSchema = z.enum(
  SHEET_GENERATION_RUN_STATUSES,
);

export type SheetGenerationRunStatus =
  (typeof SHEET_GENERATION_RUN_STATUSES)[number];

export const SHEET_GENERATION_FAILURE_CODES = [
  "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY",
  "CHARACTER_SHEET_STORAGE_UNAVAILABLE",
  "CHARACTER_SHEET_MODEL_UNAVAILABLE",
  "CHARACTER_SHEET_PLAN_OUTPUT_INVALID",
  "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID",
  "CHARACTER_SHEET_CALCULATIONS_OUTPUT_INVALID",
  "CHARACTER_SHEET_DOMAIN_INVALID",
  "CHARACTER_SHEET_COMPILE_FAILED",
] as const;

export const SheetGenerationFailureCodeSchema = z.enum(
  SHEET_GENERATION_FAILURE_CODES,
);

export type SheetGenerationFailureCode =
  (typeof SHEET_GENERATION_FAILURE_CODES)[number];

export interface SheetGenerationRun {
  runId: string;
  analysisId: string;
  rulesAnalysisRunId: string;
  ingestionId: string;
  status: SheetGenerationRunStatus;
  failureCode: SheetGenerationFailureCode | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicSheetGenerationRun {
  runId: string;
  analysisId: string;
  status: SheetGenerationRunStatus;
  failure: SheetGenerationFailureCode | null;
}

export function toPublicSheetGenerationRun(
  run: SheetGenerationRun,
): PublicSheetGenerationRun {
  return {
    runId: run.runId,
    analysisId: run.analysisId,
    status: run.status,
    failure: run.failureCode,
  };
}

/**
 * The begin request is intentionally empty: everything sheet shaping needs is
 * already captured in the READY RulesContext of the analysis session.
 */
export const SheetGenerationRequestSchema = z.strictObject({});
export type SheetGenerationRequest = z.infer<
  typeof SheetGenerationRequestSchema
>;
