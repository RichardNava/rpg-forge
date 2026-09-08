import { and, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  RulebookDeletionTransition,
  RulebookFailureCode,
  RulebookIngestion,
  RulebookProcessingTransition,
  RulebookRepositoryPort,
} from "@repo/rulebook-ingestion";
import type { Clock } from "@repo/rules-analysis-session";
import { rulesAnalysisRulebook } from "./schema.js";

export interface D1RulebookRepositoryOptions {
  clock: Clock;
}

export function createD1RulebookRepository(
  database: D1Database,
  options: D1RulebookRepositoryOptions,
): RulebookRepositoryPort {
  const db = drizzle(database, { schema: { rulesAnalysisRulebook } });
  const table = rulesAnalysisRulebook;

  return {
    async reserve(rulebook: RulebookIngestion) {
      const result = await db
        .insert(table)
        .values(toRow(rulebook))
        .onConflictDoNothing()
        .run();
      return result.meta.changes > 0 ? "reserved" : "already_attached";
    },

    async findByAnalysisId(analysisId: string) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.analysisId, analysisId))
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async findByGeneration(analysisId: string, ingestionId: string) {
      const rows = await db
        .select()
        .from(table)
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
          ),
        )
        .all();
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async markQueuedIfUploading(analysisId, ingestionId, sizeBytes) {
      const result = await db
        .update(table)
        .set({
          status: "QUEUED",
          sizeBytes,
          updatedAt: options.clock.now(),
        })
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
            eq(table.status, "UPLOADING"),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },

    async ensureProcessing(analysisId, ingestionId) {
      const result = await db
        .update(table)
        .set({ status: "PROCESSING", updatedAt: options.clock.now() })
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
            eq(table.status, "QUEUED"),
          ),
        )
        .run();
      if (result.meta.changes > 0) {
        return "transitioned" satisfies RulebookProcessingTransition;
      }

      const current = await this.findByGeneration(analysisId, ingestionId);
      return current?.status === "PROCESSING"
        ? ("already_processing" satisfies RulebookProcessingTransition)
        : ("not_current" satisfies RulebookProcessingTransition);
    },

    async markReadyIfProcessing(input) {
      const result = await db
        .update(table)
        .set({
          status: "READY",
          pageCount: input.pageCount,
          chunkCount: input.chunkCount,
          extractedChars: input.extractedChars,
          failureCode: null,
          updatedAt: options.clock.now(),
        })
        .where(
          and(
            eq(table.analysisId, input.analysisId),
            eq(table.ingestionId, input.ingestionId),
            eq(table.status, "PROCESSING"),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },

    async markFailedIfCurrent(input) {
      const result = await db
        .update(table)
        .set({
          status: "FAILED",
          failureCode: input.failureCode,
          updatedAt: options.clock.now(),
        })
        .where(
          and(
            eq(table.analysisId, input.analysisId),
            eq(table.ingestionId, input.ingestionId),
            inArray(table.status, ["UPLOADING", "QUEUED", "PROCESSING"]),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },

    async markDeleting(analysisId) {
      const current = await this.findByAnalysisId(analysisId);
      if (current === null) {
        return { kind: "not_found" } satisfies RulebookDeletionTransition;
      }
      return this.markDeletingGeneration(analysisId, current.ingestionId);
    },

    async markDeletingGeneration(analysisId, ingestionId) {
      const current = await this.findByGeneration(analysisId, ingestionId);
      if (current === null) {
        return { kind: "not_found" } satisfies RulebookDeletionTransition;
      }
      if (current.status === "DELETING") {
        return {
          kind: "already_deleting",
          rulebook: current,
        } satisfies RulebookDeletionTransition;
      }

      const now = options.clock.now();
      const result = await db
        .update(table)
        .set({ status: "DELETING", updatedAt: now })
        .where(
          and(
            eq(table.analysisId, current.analysisId),
            eq(table.ingestionId, current.ingestionId),
            ne(table.status, "DELETING"),
          ),
        )
        .run();
      if (result.meta.changes > 0) {
        return {
          kind: "transitioned",
          rulebook: { ...current, status: "DELETING", updatedAt: now },
        } satisfies RulebookDeletionTransition;
      }

      const exact = await this.findByGeneration(
        current.analysisId,
        current.ingestionId,
      );
      return exact?.status === "DELETING"
        ? ({
            kind: "already_deleting",
            rulebook: exact,
          } satisfies RulebookDeletionTransition)
        : ({ kind: "not_found" } satisfies RulebookDeletionTransition);
    },

    async deleteIfGeneration(analysisId, ingestionId) {
      await db
        .delete(table)
        .where(
          and(
            eq(table.analysisId, analysisId),
            eq(table.ingestionId, ingestionId),
          ),
        )
        .run();
    },
  };
}

function toRow(rulebook: RulebookIngestion) {
  return {
    analysisId: rulebook.analysisId,
    ingestionId: rulebook.ingestionId,
    status: rulebook.status,
    sizeBytes: rulebook.sizeBytes,
    pageCount: rulebook.pageCount,
    chunkCount: rulebook.chunkCount,
    extractedChars: rulebook.extractedChars,
    failureCode: rulebook.failureCode,
    createdAt: rulebook.createdAt,
    updatedAt: rulebook.updatedAt,
  };
}

function fromRow(
  row: typeof rulesAnalysisRulebook.$inferSelect,
): RulebookIngestion {
  return {
    analysisId: row.analysisId,
    ingestionId: row.ingestionId,
    status: row.status as RulebookIngestion["status"],
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    chunkCount: row.chunkCount,
    extractedChars: row.extractedChars,
    failureCode: row.failureCode as RulebookFailureCode | null,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}
