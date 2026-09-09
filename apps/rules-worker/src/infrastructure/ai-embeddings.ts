import {
  EMBEDDING_BATCH_SIZE,
  RULES_EMBEDDING_DIMENSIONS,
  type EmbeddingsPort,
} from "@repo/rules-analysis-run";
import { AiProviderUnavailableError } from "./ai-errors.js";

/**
 * ADR-053 embedding model. Fixed dimension is enforced on the write path.
 */
export const RULES_EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

/**
 * Workers AI embedding adapter. The caller (the analysis domain) guarantees
 * batching to EMBEDDING_BATCH_SIZE; the adapter still enforces the bound so a
 * misconfigured caller cannot issue an unbounded provider call.
 */
export function createCloudflareAiEmbeddings(ai: Ai): EmbeddingsPort {
  return {
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      if (texts.length > EMBEDDING_BATCH_SIZE) {
        throw new AiProviderUnavailableError();
      }

      let result: unknown;
      try {
        result = await ai.run(RULES_EMBEDDING_MODEL, { text: [...texts] });
      } catch {
        throw new AiProviderUnavailableError();
      }

      return validateEmbeddingOutput(result, texts.length);
    },
  };
}

/**
 * The embedding provider output is untrusted wire data: it must have exactly
 * one vector per input text, each with the fixed configured dimension.
 */
function validateEmbeddingOutput(
  result: unknown,
  expectedCount: number,
): number[][] {
  if (
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as { data?: unknown }).data)
  ) {
    throw new AiProviderUnavailableError();
  }

  const { data, shape } = result as { data: unknown[]; shape?: unknown };
  if (data.length !== expectedCount) {
    throw new AiProviderUnavailableError();
  }

  if (
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    shape[0] !== expectedCount ||
    shape[1] !== RULES_EMBEDDING_DIMENSIONS
  ) {
    throw new AiProviderUnavailableError();
  }

  const vectors: number[][] = [];
  for (const row of data) {
    if (
      !Array.isArray(row) ||
      row.length !== RULES_EMBEDDING_DIMENSIONS ||
      row.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new AiProviderUnavailableError();
    }
    vectors.push(row as number[]);
  }
  return vectors;
}
