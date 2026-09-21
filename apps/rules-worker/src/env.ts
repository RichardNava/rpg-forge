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
  SHEET_DRAFT_DEBUG?: string;
  SHEET_VISION_DEBUG_RAW_RESPONSE?: string;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
}
