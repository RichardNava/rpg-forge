import { MAX_RULEBOOK_CHUNKS } from "@repo/rulebook-ingestion";
import {
  CharacterIntentSchema,
  JsonValueSchema,
  RuleIdentifierSchema,
  RuleOverrideSchema,
  RuleSummarySchema,
  type RuleOverride,
} from "@repo/rules-context";
import { z } from "zod";

export const RULES_ANALYSIS_RUN_VERSION = 1;
export const RULES_ANALYSIS_INPUT_ARTIFACT_VERSION = 1;
export const RULES_ANALYSIS_VECTOR_MANIFEST_VERSION = 1;

/** Fixed embedding dimension per ADR-053, enforced on the write path. */
export const RULES_EMBEDDING_DIMENSIONS = 768;

/** Retrieval top-k: the bounded evidence window handed to the analysis model. */
export const RETRIEVAL_TOP_K = 8;

/** Number of text blocks embedded per provider call. */
export const EMBEDDING_BATCH_SIZE = 16;

/** A normalized rule may cite at most this many retrieved chunks. */
export const MAX_EVIDENCE_CITATIONS_PER_RULE = 16;

/**
 * Upper bound for a single evidence quote. Quotes are verified as substrings of
 * the cited chunk's text, so a quote must stay a short, bounded excerpt.
 */
export const MAX_EVIDENCE_QUOTE_CHARS = 240;

export const MAX_ANALYSIS_RULES = 512;
export const MAX_ANALYSIS_CONFLICTS = 128;

/** Upper bound for the per-chunk evidence preview sent to the model. */
export const MAX_EVIDENCE_PREVIEW_CHARS = 1_200;

/** Upper bound for the query text built from character intent + overrides. */
export const MAX_QUERY_TEXT_CHARS = 2_000;

/** Upper bound on total prompt evidence text, so a run cannot be starved. */
export const MAX_PROMPT_EVIDENCE_CHARS = 24_000;

export const RULES_ANALYSIS_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "CONFLICTS",
  "CONFIRMED",
  "READY",
  "FAILED",
  "INVALIDATED",
] as const;

export const RulesAnalysisRunStatusSchema = z.enum(RULES_ANALYSIS_RUN_STATUSES);

export type RulesAnalysisRunStatus =
  (typeof RULES_ANALYSIS_RUN_STATUSES)[number];

export const RULE_BUILD_FAILURE_CODES = [
  "RULES_CONTEXT_RULEBOOK_UNREADABLE",
  "RULES_CONTEXT_STORAGE_UNAVAILABLE",
  "RULES_CONTEXT_INDEX_UNAVAILABLE",
  "RULES_CONTEXT_MODEL_UNAVAILABLE",
  "RULES_CONTEXT_CHUNK_SOURCE_UNAVAILABLE",
  "RULES_CONTEXT_ANALYSIS_OUTPUT_INVALID",
  "RULES_CONTEXT_DOMAIN_INVALID",
] as const;

export const RuleBuildFailureCodeSchema = z.enum(RULE_BUILD_FAILURE_CODES);

export type RuleBuildFailureCode = (typeof RULE_BUILD_FAILURE_CODES)[number];

export interface RulesAnalysisRun {
  runId: string;
  analysisId: string;
  ingestionId: string;
  status: RulesAnalysisRunStatus;
  failureCode: RuleBuildFailureCode | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicRulesAnalysisRun {
  runId: string;
  analysisId: string;
  status: RulesAnalysisRunStatus;
  failure: RuleBuildFailureCode | null;
}

export function toPublicRulesAnalysisRun(
  run: RulesAnalysisRun,
): PublicRulesAnalysisRun {
  return {
    runId: run.runId,
    analysisId: run.analysisId,
    status: run.status,
    failure: run.failureCode,
  };
}

/**
 * A user-authored override arrives without an id or sourceId. The server mints
 * the id and assigns the rulebook source on begin, keeping the wire contract
 * free of fabricateable provenance.
 */
export const RuleOverrideInputSchema = z.strictObject({
  key: RuleIdentifierSchema,
  summary: RuleSummarySchema,
  structuredValue: JsonValueSchema.optional(),
});

export type RuleOverrideInput = z.infer<typeof RuleOverrideInputSchema>;

export const RulesAnalysisRequestSchema = z.strictObject({
  characterIntent: CharacterIntentSchema,
  ruleOverrides: z.array(RuleOverrideInputSchema).max(128).optional(),
});

export type RulesAnalysisRequest = z.infer<typeof RulesAnalysisRequestSchema>;

/**
 * The user-authored run input persisted as a generation-scoped temporary
 * artifact (R2), never in D1. Versioning lets providers reject stale runs.
 */
export const RulesAnalysisInputArtifactSchema = z.strictObject({
  version: z.literal(RULES_ANALYSIS_INPUT_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  ingestionId: z.uuid(),
  characterIntent: CharacterIntentSchema,
  ruleOverrides: z.array(RuleOverrideSchema).max(128),
});

export type RulesAnalysisInputArtifact = z.infer<
  typeof RulesAnalysisInputArtifactSchema
>;

/**
 * The vector id manifest persisted as a temporary artifact (R2). It is the
 * inventory the invalidation path uses to delete vectors for a run.
 */
export const RulesAnalysisVectorManifestSchema = z.strictObject({
  version: z.literal(RULES_ANALYSIS_VECTOR_MANIFEST_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  ingestionId: z.uuid(),
  vectorIds: z.array(z.string().min(1).max(200)).max(MAX_RULEBOOK_CHUNKS),
});

export type RulesAnalysisVectorManifest = z.infer<
  typeof RulesAnalysisVectorManifestSchema
>;
