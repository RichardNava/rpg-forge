import type { RuleBuildFailureCode, RulesAnalysisRun } from "./model.js";

export type RunCreationResult = "created_current" | "superseded";

export type RunClaimResult = "claimed" | "not_current";

/**
 * CAS-guarded run bookkeeping. Every mutation verifies the target run is still
 * the current run for its analysis and that its captured ingestionId still
 * matches the guard, so a stale run can never mutate a newer run's state.
 */
export interface RulesAnalysisRunRepositoryPort {
  createCurrent(run: RulesAnalysisRun): Promise<RunCreationResult>;
  findCurrent(analysisId: string): Promise<RulesAnalysisRun | null>;
  findRun(analysisId: string, runId: string): Promise<RulesAnalysisRun | null>;
  claimRunningIfCurrent(
    runId: string,
    analysisId: string,
    ingestionId: string,
  ): Promise<RunClaimResult>;
  finalizeIfCurrent(
    runId: string,
    input: {
      status: "READY" | "CONFLICTS" | "CONFIRMED";
      updatedAt: Date;
    },
  ): Promise<boolean>;
  markFailedIfCurrent(
    runId: string,
    failureCode: RuleBuildFailureCode,
    updatedAt: Date,
  ): Promise<boolean>;
  confirmIfCurrent(
    runId: string,
    input: {
      analysisId: string;
      ingestionId: string;
      updatedAt: Date;
    },
  ): Promise<boolean>;
  markInvalidatedIfCurrent(runId: string, updatedAt: Date): Promise<boolean>;
  /**
   * Marks every run of a rulebook generation (remove rulebook / re-upload /
   * session cleanup) INVALIDATED (except already-terminal FAILED rows) and
   * returns the affected rows so the caller can delete vectors + artifacts.
   */
  invalidateRunsForGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<readonly RulesAnalysisRun[]>;
  /**
   * Lists every run row (any status) for a session, used by session teardown
   * so artifacts + vectors can be removed even for already-FAILED runs.
   */
  listForAnalysis(analysisId: string): Promise<readonly RulesAnalysisRun[]>;
  /** Removes every run row for a session after its artifacts were cleaned. */
  deleteAllForAnalysis(analysisId: string): Promise<void>;
}
