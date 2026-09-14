export const SHEET_RUN_STATUSES = [
  "PENDING",
  "READY",
  "FAILED",
  "INVALIDATED",
  "EXPIRED",
] as const;

export type SheetRunStatus = (typeof SHEET_RUN_STATUSES)[number];

export const SHEET_RUN_MODES = ["pc", "npc"] as const;

export type SheetRunMode = (typeof SHEET_RUN_MODES)[number];

/**
 * Bounded, transport-neutral failure codes for the final run lifecycle. This
 * layer records that a run failed for generation or internal reasons; it never
 * duplicates the richer generation-domain error model and it does not carry
 * provider-specific errors.
 */
export const SHEET_RUN_FAILURE_CODES = [
  "GENERATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type SheetRunFailureCode = (typeof SHEET_RUN_FAILURE_CODES)[number];

/**
 * Operational record for a final character-sheet generation run. GUI-only runs
 * accept all three rulebook identities as null; rulebook-backed runs reference
 * the analysis, its run and the ingestion that produced the RulesContext.
 * Draft-backed finalization additionally carries the exact
 * `(draftId, draftVersion)` the run was generated from as operational
 * provenance: it never stores draft content, only the narrow reference. D1
 * stores neither spec JSON nor PDF bytes: that content is temporary R2
 * territory (14.7B) keyed by sessionId and runId.
 */
export interface SheetGenerationRun {
  runId: string;
  sessionId: string;
  analysisId: string | null;
  rulesAnalysisRunId: string | null;
  ingestionId: string | null;
  draftId: string | null;
  draftVersion: number | null;
  mode: SheetRunMode;
  status: SheetRunStatus;
  failureCode: SheetRunFailureCode | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export type RunCleanupCandidate = {
  sessionId: string;
  runId: string;
};

export type RunTransitionResult =
  | { kind: "transitioned"; run: SheetGenerationRun }
  | { kind: "not_found" }
  | { kind: "not_current" }
  | { kind: "wrong_state" };

export type SheetRunCreationResult =
  | { kind: "created_current"; run: SheetGenerationRun }
  | { kind: "superseded" }
  | { kind: "conflict" };
