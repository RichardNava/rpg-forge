import type {
  RunCleanupCandidate,
  RunTransitionResult,
  SheetGenerationRun,
  SheetRunCreationResult,
  SheetRunFailureCode,
} from "./sheet-run.js";

/**
 * Final character-sheet run repository port. It is deliberately distinct from
 * the legacy stage-pipeline `SheetGenerationRunRepositoryPort`: there are no
 * AI stages here, only the PENDING -> READY / PENDING -> FAILED completion
 * lifecycle plus supersede and expiry bookkeeping.
 *
 * Every terminating mutation is guarded with exact run identity + expected
 * state + currentness, and returns a discriminated outcome so future
 * orchestration (14.7D) can distinguish success, stale no-ops and terminality
 * refusals instead of swallowing them behind a boolean.
 */
export interface SheetRunRepositoryPort {
  createCurrent(run: SheetGenerationRun): Promise<SheetRunCreationResult>;
  getById(runId: string): Promise<SheetGenerationRun | null>;
  getCurrentForSession(sessionId: string): Promise<SheetGenerationRun | null>;
  markReady(runId: string, updatedAt: Date): Promise<RunTransitionResult>;
  markFailed(
    runId: string,
    failureCode: SheetRunFailureCode,
    updatedAt: Date,
  ): Promise<RunTransitionResult>;
  invalidateCurrent(
    runId: string,
    updatedAt: Date,
  ): Promise<RunTransitionResult>;
  expire(runId: string, updatedAt: Date): Promise<RunTransitionResult>;
  findCleanupCandidates(
    now: Date,
    limit: number,
  ): Promise<readonly RunCleanupCandidate[]>;
}
