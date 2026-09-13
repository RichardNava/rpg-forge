import { and, eq, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Clock, RepositoryTransition } from "@repo/rules-analysis-session";
import type { SheetSessionRepositoryPort } from "@repo/character-sheet-session";
import type { SheetSession } from "@repo/character-sheet-session";
import { SHEET_CLEANUP_RETRY_GRACE_MS } from "@repo/character-sheet-session";
import { sheetSession } from "./schema.js";

function toRow(session: SheetSession) {
  return {
    sessionId: session.sessionId,
    tokenHash: session.tokenHash,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function fromRow(row: typeof sheetSession.$inferSelect): SheetSession {
  return {
    sessionId: row.sessionId,
    tokenHash: row.tokenHash,
    status: row.status,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
    expiresAt: new Date(row.expiresAt.getTime()),
  };
}

export interface D1SheetSessionRepositoryOptions {
  clock: Clock;
}

/**
 * D1-backed sheet-session storage. Cleanup semantics mirror the
 * rules-analysis sessions exactly: expired ACTIVE sessions plus DELETING
 * sessions past their retry grace, sharing one cleanup cadence.
 */
export function createD1SheetSessionRepository(
  database: D1Database,
  options: D1SheetSessionRepositoryOptions,
): SheetSessionRepositoryPort {
  const db = drizzle(database, { schema: { sheetSession } });
  const table = sheetSession;

  return {
    async create(session: SheetSession): Promise<void> {
      await db.insert(table).values(toRow(session)).run();
    },

    async findById(sessionId: string): Promise<SheetSession | null> {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.sessionId, sessionId))
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async markDeletingIfActive(
      sessionId: string,
    ): Promise<RepositoryTransition> {
      const result = await db
        .update(table)
        .set({
          status: "DELETING",
          updatedAt: options.clock.now(),
        })
        .where(and(eq(table.sessionId, sessionId), eq(table.status, "ACTIVE")))
        .run();
      if (result.meta.changes > 0) {
        return "transitioned";
      }
      const existing = await this.findById(sessionId);
      return existing === null ? "not_found" : "already_deleting";
    },

    async findCleanupCandidates(
      now: Date,
      limit: number,
    ): Promise<SheetSession[]> {
      const graceCutoff = new Date(
        now.getTime() - SHEET_CLEANUP_RETRY_GRACE_MS,
      );
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

    async delete(sessionId: string): Promise<void> {
      await db.delete(table).where(eq(table.sessionId, sessionId)).run();
    },
  };
}
