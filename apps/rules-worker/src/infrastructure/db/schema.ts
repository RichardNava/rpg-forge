import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
