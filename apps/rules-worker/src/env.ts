import type { RulebookWorkflowParams } from "@repo/rulebook-ingestion";

export interface Env {
  DB: D1Database;
  RATE_LIMITER?: RateLimit;
  RATE_LIMIT_MODE?: string;
  RULEBOOK_BUCKET?: R2Bucket;
  RULEBOOK_INGESTION_WORKFLOW?: Workflow<RulebookWorkflowParams>;
  TURNSTILE_SECRET?: string;
}
