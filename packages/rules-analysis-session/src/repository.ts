import type { AnalysisSession } from "./session.js";

export const REPOSITORY_TRANSITIONS = [
  "transitioned",
  "already_deleting",
  "not_found",
] as const;

export type RepositoryTransition = (typeof REPOSITORY_TRANSITIONS)[number];

export interface SessionRepositoryPort {
  create(session: AnalysisSession): Promise<void>;
  findById(analysisId: string): Promise<AnalysisSession | null>;
  markDeletingIfActive(analysisId: string): Promise<RepositoryTransition>;
  findCleanupCandidates(now: Date, limit: number): Promise<AnalysisSession[]>;
  delete(analysisId: string): Promise<void>;
}
