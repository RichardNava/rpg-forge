import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  RuleBuildFailureCode,
  RulesAnalysisRun,
  RulesAnalysisRunRepositoryPort,
} from "@repo/rules-analysis-run";
import type { Clock } from "@repo/rules-analysis-session";
import { rulesAnalysisRun } from "./schema.js";

export interface D1RunRepositoryOptions {
  clock: Clock;
}

/**
 * CAS-guarded run bookkeeping backed by D1. Every mutation verifies the target
 * run is still current, and the single-current partial unique index guarantees
 * at most one current row per analysis. D1 stores operational metadata only;
 * semantic content lives in R2 artifacts.
 */
export function createD1RulesAnalysisRunRepository(
  database: D1Database,
  options: D1RunRepositoryOptions,
): RulesAnalysisRunRepositoryPort {
  const db = drizzle(database, { schema: { rulesAnalysisRun } });
  const table = rulesAnalysisRun;

  return {
    async createCurrent(run: RulesAnalysisRun) {
      const existing = await this.findCurrent(run.analysisId);
      if (existing !== null && existing.status !== "FAILED") {
        return "superseded";
      }
      if (existing !== null) {
        const superseded = await db
          .update(table)
          .set({ isCurrent: false, updatedAt: options.clock.now() })
          .where(
            and(eq(table.runId, existing.runId), eq(table.isCurrent, true)),
          )
          .run();
        if (superseded.meta.changes === 0) {
          const raced = await this.findCurrent(run.analysisId);
          if (raced !== null && raced.status !== "FAILED") {
            return "superseded";
          }
        }
      }
      try {
        await db.insert(table).values(toRow(run)).run();
      } catch {
        return "superseded";
      }
      return "created_current";
    },

    async findCurrent(analysisId: string) {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.analysisId, analysisId), eq(table.isCurrent, true)))
        .limit(1)
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async findRun(analysisId: string, runId: string) {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.runId, runId), eq(table.analysisId, analysisId)))
        .limit(1)
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async claimRunningIfCurrent(runId, analysisId, ingestionId) {
      const result = await db
        .update(table)
        .set({ status: "RUNNING" })
        .where(
          and(
            eq(table.runId, runId),
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
            eq(table.isCurrent, true),
            inArray(table.status, ["QUEUED", "RUNNING"]),
          ),
        )
        .run();
      return result.meta.changes > 0 ? "claimed" : "not_current";
    },

    async finalizeIfCurrent(runId, input) {
      const result = await db
        .update(table)
        .set({ status: input.status, updatedAt: input.updatedAt })
        .where(and(eq(table.runId, runId), eq(table.isCurrent, true)))
        .run();
      return result.meta.changes > 0;
    },

    async markFailedIfCurrent(runId, failureCode, updatedAt) {
      const result = await db
        .update(table)
        .set({ status: "FAILED", failureCode, updatedAt })
        .where(and(eq(table.runId, runId), eq(table.isCurrent, true)))
        .run();
      return result.meta.changes > 0;
    },

    async confirmIfCurrent(runId, input) {
      const result = await db
        .update(table)
        .set({ status: "CONFIRMED", updatedAt: input.updatedAt })
        .where(
          and(
            eq(table.runId, runId),
            eq(table.isCurrent, true),
            eq(table.analysisId, input.analysisId),
            eq(table.ingestionId, input.ingestionId),
            eq(table.status, "CONFLICTS"),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },

    async markInvalidatedIfCurrent(runId, updatedAt) {
      const result = await db
        .update(table)
        .set({ status: "INVALIDATED", isCurrent: false, updatedAt })
        .where(and(eq(table.runId, runId), eq(table.isCurrent, true)))
        .run();
      return result.meta.changes > 0;
    },

    async invalidateRunsForGeneration(analysisId, ingestionId) {
      const rows = await db
        .select()
        .from(table)
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
            inArray(table.status, [
              "QUEUED",
              "RUNNING",
              "CONFLICTS",
              "CONFIRMED",
              "READY",
            ]),
          ),
        )
        .all();
      if (rows.length === 0) {
        return [];
      }
      await db
        .update(table)
        .set({
          status: "INVALIDATED",
          isCurrent: false,
          updatedAt: options.clock.now(),
        })
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
            inArray(table.status, [
              "QUEUED",
              "RUNNING",
              "CONFLICTS",
              "CONFIRMED",
              "READY",
            ]),
          ),
        )
        .run();
      return rows.map((row) =>
        fromRow({ ...row, status: "INVALIDATED", isCurrent: false }),
      );
    },

    async listForAnalysis(analysisId: string) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.analysisId, analysisId))
        .all();
      return rows.map((row) => fromRow(row));
    },

    async deleteAllForAnalysis(analysisId: string) {
      await db.delete(table).where(eq(table.analysisId, analysisId)).run();
    },
  };
}

function toRow(run: RulesAnalysisRun) {
  return {
    runId: run.runId,
    analysisId: run.analysisId,
    ingestionId: run.ingestionId,
    status: run.status,
    failureCode: run.failureCode,
    isCurrent: run.isCurrent,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function fromRow(row: typeof rulesAnalysisRun.$inferSelect): RulesAnalysisRun {
  return {
    runId: row.runId,
    analysisId: row.analysisId,
    ingestionId: row.ingestionId,
    status: row.status as RulesAnalysisRun["status"],
    failureCode: row.failureCode as RuleBuildFailureCode | null,
    isCurrent: row.isCurrent,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}
