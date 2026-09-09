import type { RulebookChunk } from "@repo/rulebook-ingestion";
import {
  JsonValueSchema,
  NormalizedRuleIdSchema,
  RuleConflictIdSchema,
  RuleIdentifierSchema,
  RuleSourceIdSchema,
  RuleSummarySchema,
  RulesContextSchema,
  type CharacterIntent,
  type RuleOverride,
  type RulesContext,
  type UploadedRulebookSource,
} from "@repo/rules-context";
import { z } from "zod";
import {
  MAX_ANALYSIS_CONFLICTS,
  MAX_ANALYSIS_RULES,
  MAX_EVIDENCE_CITATIONS_PER_RULE,
  MAX_EVIDENCE_QUOTE_CHARS,
} from "./model.js";

/**
 * One grounded citation: the chunkId of the retrieved chunk plus a verbatim
 * quote that must occur inside that chunk's text. The quote is a provider-sided
 * proof of grounding; it is never persisted into the canonical RulesContext.
 */
export const AnalysisEvidenceCitationSchema = z.strictObject({
  chunkId: RuleIdentifierSchema,
  quote: z.string().min(1).max(MAX_EVIDENCE_QUOTE_CHARS),
});

export type AnalysisEvidenceCitation = z.infer<
  typeof AnalysisEvidenceCitationSchema
>;

export const AnalysisNormalizedRuleSchema = z.strictObject({
  id: NormalizedRuleIdSchema,
  category: RuleIdentifierSchema,
  key: RuleIdentifierSchema,
  summary: RuleSummarySchema,
  structuredValue: JsonValueSchema.optional(),
  evidence: z
    .array(AnalysisEvidenceCitationSchema)
    .min(1)
    .max(MAX_EVIDENCE_CITATIONS_PER_RULE),
  confidence: z.number().min(0).max(1),
});

export type AnalysisNormalizedRule = z.infer<
  typeof AnalysisNormalizedRuleSchema
>;

export const AnalysisConflictSchema = z
  .strictObject({
    id: RuleConflictIdSchema,
    category: RuleIdentifierSchema,
    key: RuleIdentifierSchema,
    description: RuleSummarySchema,
    competingRuleIds: z.array(NormalizedRuleIdSchema).min(1).max(32),
    competingSourceIds: z.array(RuleSourceIdSchema).max(32),
  })
  .superRefine((conflict, context) => {
    if (
      conflict.competingRuleIds.length === 0 &&
      conflict.competingSourceIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A conflict must identify at least one competing rule or source.",
      });
    }
  });

export type AnalysisConflict = z.infer<typeof AnalysisConflictSchema>;

/**
 * Structured model output. Every normalized rule must cite retrieved chunks
 * with substrings that genuinely occur in those chunks; fabricated quotes and
 * unretrieved chunkIds are rejected.
 */
export const RulesAnalysisOutputSchema = z.strictObject({
  normalizedRules: z
    .array(AnalysisNormalizedRuleSchema)
    .max(MAX_ANALYSIS_RULES),
  conflicts: z.array(AnalysisConflictSchema).max(MAX_ANALYSIS_CONFLICTS),
});

export type RulesAnalysisOutput = z.infer<typeof RulesAnalysisOutputSchema>;

export function getRulesAnalysisOutputJsonSchema() {
  return z.toJSONSchema(RulesAnalysisOutputSchema, { reused: "ref" });
}

export class AnalysisEvidenceError extends Error {
  readonly details: string;

  constructor(details: string) {
    super(details);
    this.name = "AnalysisEvidenceError";
    this.details = details;
  }
}

/**
 * Conservative whitespace normalization for evidence comparison: collapse any
 * run of whitespace to a single space and trim. Punctuation and case are
 * preserved, so PDF line breaks do not void otherwise verbatim quotes.
 */
export function normalizeEvidenceText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Verifies every evidence citation in the model output against the retrieved
 * chunks. Returns a human-readable problem summary (suitable as prompt-replay
 * feedback) or null when every citation is grounded.
 */
export function verifyEvidence(
  output: RulesAnalysisOutput,
  chunkById: ReadonlyMap<string, RulebookChunk>,
  retrievedChunkIds: ReadonlySet<string>,
): string | null {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const rule of output.normalizedRules) {
    for (const citation of rule.evidence) {
      const key = `${citation.chunkId}:${citation.quote}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!retrievedChunkIds.has(citation.chunkId)) {
        problems.push(
          `chunk "${citation.chunkId}" was cited but never retrieved`,
        );
        continue;
      }
      const chunk = chunkById.get(citation.chunkId);
      if (chunk === undefined) {
        problems.push(`chunk "${citation.chunkId}" is unknown in this run`);
        continue;
      }
      const quote = normalizeEvidenceText(citation.quote);
      if (quote.length === 0) {
        problems.push(`the quote for chunk "${citation.chunkId}" is empty`);
        continue;
      }
      if (!normalizeEvidenceText(chunk.text).includes(quote)) {
        problems.push(
          `the quote for chunk "${citation.chunkId}" is not a substring of the retrieved text`,
        );
      }
    }
  }
  if (problems.length === 0) {
    return null;
  }
  return `The following evidence citations are invalid and must be corrected: ${problems.join("; ")}.`;
}

export interface AnalysisMappingInput {
  analysisId: string;
  source: UploadedRulebookSource;
  chunks: readonly RulebookChunk[];
  retrievedChunkIds: ReadonlySet<string>;
  characterIntent: CharacterIntent;
  overrides: readonly RuleOverride[];
  output: RulesAnalysisOutput;
}

/**
 * Maps validated model output onto the canonical RulesContext. Citations are
 * derived only from retrieved chunk provenance (pageStart/pageEnd/chunkId), so
 * the result satisfies RulesContextSchema + validateRulesContextDomain.
 */
export function mapAnalysisOutputToRulesContext(
  input: AnalysisMappingInput,
): RulesContext {
  const chunkById = new Map(
    input.chunks.map((chunk) => [chunk.chunkId, chunk]),
  );

  const invalid = verifyEvidence(
    input.output,
    chunkById,
    input.retrievedChunkIds,
  );
  if (invalid !== null) {
    throw new AnalysisEvidenceError(invalid);
  }

  const normalizedRules = input.output.normalizedRules.map((rule) => {
    const seen = new Set<string>();
    const citations = [];
    for (const citation of rule.evidence) {
      if (seen.has(citation.chunkId)) {
        continue;
      }
      seen.add(citation.chunkId);
      const chunk = chunkById.get(citation.chunkId);
      if (chunk === undefined) {
        throw new AnalysisEvidenceError(
          `chunk "${citation.chunkId}" is unknown in this run`,
        );
      }
      citations.push({
        sourceId: input.source.id,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: null,
        chunkId: chunk.chunkId,
      });
    }
    return {
      id: rule.id,
      category: rule.category,
      key: rule.key,
      summary: rule.summary,
      ...(rule.structuredValue === undefined
        ? {}
        : { structuredValue: rule.structuredValue }),
      citations,
      confidence: rule.confidence,
    };
  });

  const conflicts = input.output.conflicts.map((conflict) => ({
    id: conflict.id,
    category: conflict.category,
    key: conflict.key,
    description: conflict.description,
    competingRuleIds: conflict.competingRuleIds,
    competingSourceIds: conflict.competingSourceIds,
    status: "unresolved" as const,
    resolution: null,
  }));

  const context: RulesContext = {
    schemaVersion: "1",
    analysisId: input.analysisId,
    sources: [input.source],
    authorityOrder: [input.source.id],
    characterIntent: input.characterIntent,
    ruleOverrides: [...input.overrides],
    normalizedRules,
    conflicts,
    status: conflicts.length > 0 ? "conflicts" : "ready",
  };

  return RulesContextSchema.parse(context);
}
