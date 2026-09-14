import {
  SHEET_RUN_FAILURE_CODES,
  SHEET_RUN_MODES,
  SHEET_RUN_STATUSES,
  SHEET_SESSION_STATUSES,
} from "@repo/character-sheet-session";
import {
  RULEBOOK_FAILURE_CODES,
  RULEBOOK_STATUSES,
} from "@repo/rulebook-ingestion";
import {
  RULE_BUILD_FAILURE_CODES,
  RULES_ANALYSIS_RUN_STATUSES,
} from "@repo/rules-analysis-run";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

/**
 * Operational metadata for a rules-analysis run. D1 intentionally stores NO
 * character intent, overrides, RulesContext JSON, retrieval text, candidate
 * output, or vector ids: those live in generation-scoped temporary R2
 * artifacts so that the shared status row stays small and queue-friendly.
 */
export const rulesAnalysisRun = sqliteTable(
  "rules_analysis_runs",
  {
    runId: text("run_id").primaryKey(),
    analysisId: text("analysis_id").notNull(),
    ingestionId: text("ingestion_id").notNull(),
    status: text("status", {
      enum: RULES_ANALYSIS_RUN_STATUSES,
    }).notNull(),
    failureCode: text("failure_code", {
      enum: RULE_BUILD_FAILURE_CODES,
    }),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("rules_analysis_runs_current_idx").on(
      table.analysisId,
      table.isCurrent,
    ),
    index("rules_analysis_runs_generation_idx").on(
      table.analysisId,
      table.ingestionId,
    ),
    index("rules_analysis_runs_cleanup_idx").on(table.status, table.updatedAt),
    uniqueIndex("rules_analysis_runs_single_current_idx")
      .on(table.analysisId)
      .where(sql`${table.isCurrent} = 1`),
  ],
);

export type RulesAnalysisRunRow = typeof rulesAnalysisRun.$inferSelect;

/**
 * Temporary sheet-generation session. Persisted D1 state is limited to the
 * SHA-256 token hash, lifecycle and cleanup timestamps; the plaintext token
 * is returned exactly once to the caller and never stored.
 */
export const sheetSession = sqliteTable(
  "sheet_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: SHEET_SESSION_STATUSES }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sheet_sessions_cleanup_idx").on(table.status, table.expiresAt),
  ],
);

export type SheetSessionRow = typeof sheetSession.$inferSelect;

/**
 * Operational metadata for a sheet-generation run. D1 intentionally stores NO
 * spec JSON, PDF bytes, RulesContext, job payload, or artifact keys: those live
 * in generation-scoped temporary artifacts. A GUI-only run keeps all three
 * rulebook identities NULL. expiresAt inherits the owning session's expiry so
 * cleanup candidates derive from one authoritative lifetime.
 */
export const sheetGenerationRun = sqliteTable(
  "sheet_generation_runs",
  {
    runId: text("run_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    analysisId: text("analysis_id"),
    rulesAnalysisRunId: text("rules_analysis_run_id"),
    ingestionId: text("ingestion_id"),
    draftId: text("draft_id"),
    draftVersion: integer("draft_version"),
    mode: text("mode", { enum: SHEET_RUN_MODES }).notNull(),
    status: text("status", { enum: SHEET_RUN_STATUSES }).notNull(),
    failureCode: text("failure_code", { enum: SHEET_RUN_FAILURE_CODES }),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sheet_generation_runs_current_idx").on(
      table.sessionId,
      table.isCurrent,
    ),
    index("sheet_generation_runs_cleanup_idx").on(
      table.status,
      table.expiresAt,
    ),
    uniqueIndex("sheet_generation_runs_single_current_idx")
      .on(table.sessionId)
      .where(sql`${table.isCurrent} = 1`),
  ],
);

export type SheetGenerationRunRow = typeof sheetGenerationRun.$inferSelect;

/**
 * D1 operational coordination row for draft-version mutation. Stores zero draft
 * content: only the committed version and, while a mutation is in flight, the
 * claimed next version + its claim id. The PK is the `(sessionId, draftId)`
 * pair; `pending_since` is the bounded staleness anchor for stale-claim
 * recovery.
 */
export const sheetDraftHead = sqliteTable(
  "sheet_draft_heads",
  {
    sessionId: text("session_id").notNull(),
    draftId: text("draft_id").notNull(),
    currentVersion: integer("current_version").notNull(),
    pendingVersion: integer("pending_version"),
    pendingClaimId: text("pending_claim_id"),
    pendingSince: integer("pending_since", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.draftId] }),
    index("sheet_draft_heads_session_idx").on(table.sessionId),
    index("sheet_draft_heads_pending_idx").on(
      table.pendingVersion,
      table.pendingSince,
    ),
  ],
);

export type SheetDraftHeadRow = typeof sheetDraftHead.$inferSelect;
