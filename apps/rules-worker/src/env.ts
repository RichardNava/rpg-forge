import type { RulebookWorkflowParams } from "@repo/rulebook-ingestion";
import type { RulesAnalysisWorkflowParams } from "./rules-analysis-workflow.js";

export interface Env {
  DB: D1Database;
  RATE_LIMITER?: RateLimit;
  RATE_LIMIT_MODE?: string;
  RULEBOOK_BUCKET?: R2Bucket;
  SHEET_ARTIFACTS?: R2Bucket;
  RULEBOOK_INGESTION_WORKFLOW?: Workflow<RulebookWorkflowParams>;
  RULES_ANALYSIS_WORKFLOW?: Workflow<RulesAnalysisWorkflowParams>;
  TURNSTILE_SECRET?: string;
  TURNSTILE_MODE?: string;
  SHEET_VISION_MODEL?: string;
  SHEET_PRESENTATION_MODEL?: string;
  SHEET_PORTRAIT_MODEL?: string;
  /**
   * Explicit model for advanced character authoring (14.14): NPC
   * instruction-driven blank-value authoring and AI-assisted draft
   * proposals. Both narrow adapters may share this model; the domain ports
   * remain separate. Absent binding/model fails closed (no authoring port).
   */
  SHEET_AUTHORING_MODEL?: string;
  SHEET_DRAFT_DEBUG?: string;
  SHEET_VISION_DEBUG_RAW_RESPONSE?: string;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
}
