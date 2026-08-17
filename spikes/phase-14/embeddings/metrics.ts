import {
  benchmarkDocuments,
  expectedDocumentIds,
  type RetrievalQuery,
  type RulePassage,
} from "./corpus";

export interface EmbeddingBenchmarkMetrics {
  readonly dimensions: number;
  readonly top1Accuracy: number;
  readonly top3Accuracy: number;
  readonly crossLanguageTop1Accuracy: number;
  readonly crossLanguageTop3Accuracy: number;
  readonly meanReciprocalRank: number;
  readonly recallAt3: number;
  readonly averageRelevantSimilarity: number;
  readonly averageDistractorSeparation: number;
}

export function evaluateEmbeddingBenchmark(
  documents: readonly RulePassage[],
  queries: readonly RetrievalQuery[],
  documentEmbeddings: readonly (readonly number[])[],
  queryEmbeddings: readonly (readonly number[])[],
): EmbeddingBenchmarkMetrics {
  validateVectors(documents, documentEmbeddings, "document");
  validateVectors(queries, queryEmbeddings, "query");

  const dimensions = documentEmbeddings[0]?.length;
  if (dimensions === undefined) {
    throw new Error("At least one document embedding is required.");
  }
  if (queryEmbeddings[0]?.length !== dimensions) {
    throw new Error("Document and query embedding dimensions must match.");
  }

  const scoredQueries = queries.map((query, queryIndex) => {
    const queryEmbedding = queryEmbeddings[queryIndex];
    if (queryEmbedding === undefined) {
      throw new Error(`Missing embedding for query ${query.id}.`);
    }

    const ranked = documents
      .map((document, documentIndex) => {
        const documentEmbedding = documentEmbeddings[documentIndex];
        if (documentEmbedding === undefined) {
          throw new Error(`Missing embedding for document ${document.id}.`);
        }

        return {
          document,
          score: cosineSimilarity(queryEmbedding, documentEmbedding),
        };
      })
      .sort((left, right) => right.score - left.score);

    const relevantIds = expectedDocumentIds(query);
    const relevantEntries = ranked.filter((entry) =>
      relevantIds.includes(entry.document.id),
    );
    const strongestDistractor = ranked.find(
      (entry) =>
        entry.document.kind === "distractor" ||
        !relevantIds.includes(entry.document.id),
    );

    if (relevantEntries.length === 0 || !strongestDistractor) {
      throw new Error(
        `Benchmark corpus is missing a comparison for ${query.id}.`,
      );
    }

    const bestRelevantScore = Math.max(
      ...relevantEntries.map((entry) => entry.score),
    );

    const firstRelevantRank =
      ranked.findIndex((entry) => relevantIds.includes(entry.document.id)) + 1;

    const top3RelevantCount = ranked
      .slice(0, 3)
      .filter((entry) => relevantIds.includes(entry.document.id)).length;

    return {
      query,
      relevantScore: bestRelevantScore,
      top1: relevantIds.includes(ranked[0]?.document.id ?? ""),
      top3: ranked
        .slice(0, 3)
        .some((entry) => relevantIds.includes(entry.document.id)),
      firstRelevantRank,
      top3RelevantCount,
      totalRelevant: relevantIds.length,
      distractorSeparation: bestRelevantScore - strongestDistractor.score,
    };
  });

  const crossLanguage = scoredQueries.filter(
    (result) => result.query.language !== result.query.targetLanguage,
  );

  return {
    dimensions,
    top1Accuracy: average(scoredQueries.map((result) => Number(result.top1))),
    top3Accuracy: average(scoredQueries.map((result) => Number(result.top3))),
    crossLanguageTop1Accuracy: average(
      crossLanguage.map((result) => Number(result.top1)),
    ),
    crossLanguageTop3Accuracy: average(
      crossLanguage.map((result) => Number(result.top3)),
    ),
    meanReciprocalRank: average(
      scoredQueries.map((result) => 1 / result.firstRelevantRank),
    ),
    recallAt3: average(
      scoredQueries.map(
        (result) => result.top3RelevantCount / result.totalRelevant,
      ),
    ),
    averageRelevantSimilarity: average(
      scoredQueries.map((result) => result.relevantScore),
    ),
    averageDistractorSeparation: average(
      scoredQueries.map((result) => result.distractorSeparation),
    ),
  };
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error(
      "Cosine similarity requires equally sized, non-empty vectors.",
    );
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error("Embedding values must be present.");
    }
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Embedding values must be finite numbers.");
    }

    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    throw new Error("Cosine similarity is undefined for a zero vector.");
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

function validateVectors(
  items: readonly { readonly id: string }[],
  embeddings: readonly (readonly number[])[],
  kind: "document" | "query",
): void {
  if (items.length !== embeddings.length) {
    throw new Error(`Expected one ${kind} embedding for each benchmark item.`);
  }

  const dimensions = embeddings[0]?.length;
  if (dimensions === undefined || dimensions === 0) {
    throw new Error(`${kind} embeddings must contain at least one dimension.`);
  }

  for (const embedding of embeddings) {
    if (embedding.length !== dimensions) {
      throw new Error(`${kind} embedding dimensions must be consistent.`);
    }
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot average an empty metric set.");
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
