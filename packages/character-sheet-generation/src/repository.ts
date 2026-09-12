import type {
  SheetGenerationFailureCode,
  SheetGenerationRun,
} from "./model.js";

export type SheetRunCreationResult = "created_current" | "superseded";
export type SheetRunClaimResult = "claimed" | "not_current";

/**
 * CAS-guarded run bookkeeping. D1 stores operational metadata only; semantic
 * content lives in temporary R2 artifacts. Every mutation verifies the run is
 * still current, and implementations enforce the triple-identity
 * (analysisId, rulesAnalysisRunId, ingestionId) so a stale sheet generation
 * derived from an old RulesContext can never keep making progress.
 */
export interface SheetGenerationRunRepositoryPort {
  findCurrent(analysisId: string): Promise<SheetGenerationRun | null>;
  findRun(
    analysisId: string,
    runId: string,
  ): Promise<SheetGenerationRun | null>;
  createCurrent(run: SheetGenerationRun): Promise<SheetRunCreationResult>;
  claimGeneratingIfCurrent(
    runId: string,
    analysisId: string,
    rulesAnalysisRunId: string,
    ingestionId: string,
  ): Promise<SheetRunClaimResult>;
  claimCompilingIfCurrent(runId: string): Promise<boolean>;
  finalizeReadyIfCurrent(runId: string): Promise<boolean>;
  markFailedIfCurrent(
    runId: string,
    failureCode: SheetGenerationFailureCode,
    updatedAt: Date,
  ): Promise<boolean>;
  markInvalidatedIfCurrent(runId: string, updatedAt: Date): Promise<boolean>;
  /**
   * Marks every non-terminal run of an analysis INVALIDATED and non-current,
   * returning the affected rows. Used when the derivation source is removed.
   */
  invalidateSheetsForAnalysis(
    analysisId: string,
  ): Promise<readonly SheetGenerationRun[]>;
  listForAnalysis(analysisId: string): Promise<readonly SheetGenerationRun[]>;
  deleteAllForAnalysis(analysisId: string): Promise<void>;
}
