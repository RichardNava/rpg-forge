import { and, eq, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Clock } from "@repo/rules-analysis-session";
import type {
  RunCleanupCandidate,
  RunTransitionResult,
  SheetGenerationRun,
  SheetRunCreationResult,
  SheetRunFailureCode,
  SheetRunRepositoryPort,
} from "@repo/character-sheet-session";
import { sheetGenerationRun } from "./schema.js";

export interface D1SheetRunRepositoryOptions {
  clock: Clock;
}

/**
 * CAS-guarded, D1-backed sheet-run lifecycle.
 *
 * `createCurrent` is repost-as-reroll: one atomic batch invalidates whatever
 * run is current for the session (any status) and inserts the new current run.
 * The `(session_id) WHERE is_current = 1` partial unique index is the database
 * backstop; if a concurrent create surfaces a unique violation the whole batch
 * rolls back and the caller receives a deterministic, retryable `conflict`
 * outcome.
 *
 * Terminal transitions verify exact run identity + currentness + expected
 * state and return a discriminated outcome so orchestration (14.7D) can
 * distinguish success, stale no-ops and terminality refusals.
 */
export function createD1SheetRunRepository(
  database: D1Database,
  options: D1SheetRunRepositoryOptions,
): SheetRunRepositoryPort {
  const db = drizzle(database, { schema: { sheetGenerationRun } });
  const table = sheetGenerationRun;

  async function findById(runId: string): Promise<SheetGenerationRun | null> {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.runId, runId))
      .all();
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  /**
   * Runs a state-guarded transition; if the guarded UPDATE touched zero rows a
   * post-read distinguishes not_found / not_current / wrong_state.
   */
  async function guardedTransition(
    runId: string,
    expected: readonly SheetGenerationRun["status"][],
    set: {
      status: SheetGenerationRun["status"];
      isCurrent: boolean;
      failureCode?: SheetRunFailureCode | null;
    },
    updatedAt: Date,
  ): Promise<RunTransitionResult> {
    const result = await db
      .update(table)
      .set({
        status: set.status,
        isCurrent: set.isCurrent,
        ...(set.failureCode === undefined
          ? {}
          : { failureCode: set.failureCode }),
        updatedAt,
      })
      .where(
        and(
          eq(table.runId, runId),
          eq(table.isCurrent, true),
          inArray(table.status, expected),
        ),
      )
      .run();
    if (result.meta.changes > 0) {
      return { kind: "transitioned", run: (await findById(runId))! };
    }
    const existing = await findById(runId);
    if (existing === null) {
      return { kind: "not_found" };
    }
    if (!existing.isCurrent) {
      return { kind: "not_current" };
    }
    return { kind: "wrong_state" };
  }

  return {
    async createCurrent(
      run: SheetGenerationRun,
    ): Promise<SheetRunCreationResult> {
      try {
        await db.batch([
          db
            .update(table)
            .set({
              status: "INVALIDATED",
              isCurrent: false,
              updatedAt: options.clock.now(),
            })
            .where(
              and(
                eq(table.sessionId, run.sessionId),
                eq(table.isCurrent, true),
              ),
            ),
          db.insert(table).values(toRow(run)),
        ]);
      } catch {
        return { kind: "conflict" };
      }
      return { kind: "created_current", run };
    },

    async getById(runId: string): Promise<SheetGenerationRun | null> {
      return findById(runId);
    },

    async getCurrentForSession(
      sessionId: string,
    ): Promise<SheetGenerationRun | null> {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.sessionId, sessionId), eq(table.isCurrent, true)))
        .limit(1)
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async markReady(
      runId: string,
      updatedAt: Date,
    ): Promise<RunTransitionResult> {
      return guardedTransition(
        runId,
        ["PENDING"],
        { status: "READY", isCurrent: true, failureCode: null },
        updatedAt,
      );
    },

    async markFailed(
      runId: string,
      failureCode: SheetRunFailureCode,
      updatedAt: Date,
    ): Promise<RunTransitionResult> {
      return guardedTransition(
        runId,
        ["PENDING"],
        { status: "FAILED", isCurrent: true, failureCode },
        updatedAt,
      );
    },

    async invalidateCurrent(
      runId: string,
      updatedAt: Date,
    ): Promise<RunTransitionResult> {
      return guardedTransition(
        runId,
        ["PENDING", "READY"],
        { status: "INVALIDATED", isCurrent: false },
        updatedAt,
      );
    },

    async expire(runId: string, updatedAt: Date): Promise<RunTransitionResult> {
      return guardedTransition(
        runId,
        ["PENDING", "READY"],
        { status: "EXPIRED", isCurrent: false },
        updatedAt,
      );
    },

    async findCleanupCandidates(
      now: Date,
      limit: number,
    ): Promise<readonly RunCleanupCandidate[]> {
      const rows = await db
        .select({
          sessionId: table.sessionId,
          runId: table.runId,
        })
        .from(table)
        .where(lte(table.expiresAt, now))
        .orderBy(table.expiresAt)
        .limit(limit)
        .all();
      return rows;
    },
  };
}

function toRow(run: SheetGenerationRun) {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    analysisId: run.analysisId,
    rulesAnalysisRunId: run.rulesAnalysisRunId,
    ingestionId: run.ingestionId,
    draftId: run.draftId,
    draftVersion: run.draftVersion,
    mode: run.mode,
    status: run.status,
    failureCode: run.failureCode,
    isCurrent: run.isCurrent,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expiresAt: run.expiresAt,
  };
}

function fromRow(
  row: typeof sheetGenerationRun.$inferSelect,
): SheetGenerationRun {
  return {
    runId: row.runId,
    sessionId: row.sessionId,
    analysisId: row.analysisId,
    rulesAnalysisRunId: row.rulesAnalysisRunId,
    ingestionId: row.ingestionId,
    draftId: row.draftId,
    draftVersion: row.draftVersion,
    mode: row.mode,
    status: row.status,
    failureCode: row.failureCode,
    isCurrent: row.isCurrent,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
    expiresAt: new Date(row.expiresAt.getTime()),
  };
}
