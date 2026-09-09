import type { RulebookChunk } from "@repo/rulebook-ingestion";
import type {
  CharacterIntent,
  RuleOverride,
  RulesContext,
} from "@repo/rules-context";
import type { RulesAnalysisInputArtifact } from "./model.js";
import type { RetrievalRecord } from "./retrieval.js";

export { type RetrievalRecord } from "./retrieval.js";

export interface EmbeddingsPort {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface VectorRecord {
  id: string;
  values: number[];
}

export interface RetrievedVector {
  id: string;
}

/**
 * Shared Vectorize index. Every production call carries a namespace; the run
 * domain never performs a namespace-less read or write.
 */
export interface RuleVectorIndexPort {
  upsert(input: {
    namespace: string;
    vectors: readonly VectorRecord[];
  }): Promise<void>;
  query(input: {
    namespace: string;
    vector: readonly number[];
    topK: number;
  }): Promise<readonly RetrievedVector[]>;
  deleteByIds(input: {
    namespace: string;
    ids: readonly string[];
  }): Promise<void>;
}

/**
 * Returns the raw model JSON text. Structured parsing happens in the domain.
 * The port is role-separated on purpose: `system` carries trusted instructions
 * only, while `user` carries the untrusted run data (character intent, house
 * rules, retrieved rulebook text). PDF-derived text must never reach the
 * system channel.
 */
export interface RuleAnalysisPort {
  generate(input: { system: string; user: string }): Promise<string>;
}

export interface ChunkSourcePort {
  readChunks(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<readonly RulebookChunk[]>;
}

/**
 * Generation-scoped temporary artifacts (R2). The domain writes the canonical
 * input/context/vector manifest here; D1 persists only operational metadata.
 * Implementations MUST reject stale artifacts: an artifact is only readable or
 * deletable under the exact runId that wrote it, and operations must never
 * cross generation boundaries.
 */
export interface RunArtifactPort {
  putInput(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    characterIntent: CharacterIntent;
    ruleOverrides: readonly RuleOverride[];
  }): Promise<void>;
  getInput(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<RulesAnalysisInputArtifact | null>;
  putContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    context: RulesContext;
  }): Promise<void>;
  getContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<RulesContext | null>;
  putRetrieval(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    retrieval: RetrievalRecord;
  }): Promise<void>;
  putVectorManifest(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    vectorIds: readonly string[];
  }): Promise<void>;
  getVectorManifest(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<readonly string[] | null>;
  deleteRunArtifacts(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<void>;
}

export interface RulebookFileHashPort {
  hashRulebookRaw(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<string>;
}
