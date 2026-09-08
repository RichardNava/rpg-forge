import {
  RULEBOOK_FAILURE_CODES,
  RULEBOOK_STATUSES,
} from "@repo/rulebook-ingestion";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const rulesAnalysisSession = sqliteTable(
  "rules_analysis_sessions",
  {
    analysisId: text("analysis_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: ["ACTIVE", "DELETING"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("rules_analysis_sessions_cleanup_idx").on(
      table.status,
      table.expiresAt,
    ),
  ],
);

export type RulesAnalysisSessionRow = typeof rulesAnalysisSession.$inferSelect;

export const rulesAnalysisRulebook = sqliteTable(
  "rules_analysis_rulebooks",
  {
    analysisId: text("analysis_id").primaryKey(),
    ingestionId: text("ingestion_id").notNull(),
    status: text("status", { enum: RULEBOOK_STATUSES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count"),
    extractedChars: integer("extracted_chars"),
    failureCode: text("failure_code", {
      enum: RULEBOOK_FAILURE_CODES,
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("rules_analysis_rulebooks_ingestion_id_idx").on(
      table.ingestionId,
    ),
    index("rules_analysis_rulebooks_cleanup_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export type RulesAnalysisRulebookRow =
  typeof rulesAnalysisRulebook.$inferSelect;
