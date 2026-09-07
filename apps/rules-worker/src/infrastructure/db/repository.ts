import { and, eq, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  CLEANUP_RETRY_GRACE_MS,
  type AnalysisSession,
  type Clock,
  type RepositoryTransition,
  type SessionRepositoryPort,
} from "@repo/rules-analysis-session";
import { rulesAnalysisSession } from "./schema.js";

function toRow(session: AnalysisSession) {
  return {
    analysisId: session.analysisId,
    tokenHash: session.tokenHash,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function fromRow(
  row: typeof rulesAnalysisSession.$inferSelect,
): AnalysisSession {
  return {
    analysisId: row.analysisId,
    tokenHash: row.tokenHash,
    status: row.status,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
    expiresAt: new Date(row.expiresAt.getTime()),
  };
}

export interface D1SessionRepositoryOptions {
  clock: Clock;
}

export function createD1SessionRepository(
  env: D1Database,
  options: D1SessionRepositoryOptions,
): SessionRepositoryPort {
  const db = drizzle(env, { schema: { rulesAnalysisSession } });
  const table = rulesAnalysisSession;

  return {
    async create(session: AnalysisSession): Promise<void> {
      await db.insert(table).values(toRow(session)).run();
    },

    async findById(analysisId: string): Promise<AnalysisSession | null> {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.analysisId, analysisId))
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async markDeletingIfActive(
      analysisId: string,
    ): Promise<RepositoryTransition> {
      const result = await db
        .update(table)
        .set({
          status: "DELETING",
          updatedAt: options.clock.now(),
        })
        .where(
          and(eq(table.analysisId, analysisId), eq(table.status, "ACTIVE")),
        )
        .run();
      if (result.meta.changes > 0) {
        return "transitioned";
      }
      const existing = await this.findById(analysisId);
      return existing === null ? "not_found" : "already_deleting";
    },

    async findCleanupCandidates(
      now: Date,
      limit: number,
    ): Promise<AnalysisSession[]> {
      const graceCutoff = new Date(now.getTime() - CLEANUP_RETRY_GRACE_MS);
      const rows = await db
        .select()
        .from(table)
        .where(
          or(
            and(eq(table.status, "ACTIVE"), lte(table.expiresAt, now)),
            and(
              eq(table.status, "DELETING"),
              lte(table.updatedAt, graceCutoff),
            ),
          ),
        )
        .limit(limit)
        .all();
      return rows.map((row) => fromRow(row));
    },

    async delete(analysisId: string): Promise<void> {
      await db.delete(table).where(eq(table.analysisId, analysisId)).run();
    },
  };
}
