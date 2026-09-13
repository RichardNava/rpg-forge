import type { RepositoryTransition } from "@repo/rules-analysis-session";
import type { SheetSession } from "./sheet-session.js";

/**
 * Narrow persistence contract for temporary character-sheet sessions. No
 * browse/history APIs: a session is created, read, authorized, marked for
 * deletion and found by cleanup. The authorized read (token verification +
 * expiry) lives in the session service, matching the rules-analysis pattern.
 */
export interface SheetSessionRepositoryPort {
  create(session: SheetSession): Promise<void>;
  findById(sessionId: string): Promise<SheetSession | null>;
  markDeletingIfActive(sessionId: string): Promise<RepositoryTransition>;
  findCleanupCandidates(now: Date, limit: number): Promise<SheetSession[]>;
  delete(sessionId: string): Promise<void>;
}
