import { describe, expect, it } from "vitest";

import {
  benchmarkDocuments,
  benchmarkQueries,
  distractorPassages,
  rulePassages,
  expectedDocumentId,
  expectedDocumentIds,
} from "./corpus";
import { cosineSimilarity, evaluateEmbeddingBenchmark } from "./metrics";

describe("multilingual embedding benchmark corpus and metrics", () => {
  it("contains 38 concepts, 76 rule passages, 30 distractors, and 208 queries", () => {
    const enRules = rulePassages.filter((p) => p.language === "en");
    const esRules = rulePassages.filter((p) => p.language === "es");

    expect(enRules).toHaveLength(38);
    expect(esRules).toHaveLength(38);
    expect(rulePassages).toHaveLength(76);
    expect(distractorPassages).toHaveLength(30);
    expect(benchmarkDocuments).toHaveLength(106);
    expect(benchmarkQueries).toHaveLength(208);

    const crossLanguage = benchmarkQueries.filter(
      (q) => q.language !== q.targetLanguage,
    );
    expect(crossLanguage.length).toBeGreaterThan(0);
  });

  it("maps expectedDocumentId to the English variant for every query", () => {
    for (const query of benchmarkQueries) {
      const primary = expectedDocumentId(query);
      expect(primary).toBe(`${query.conceptId}-en`);

      const doc = benchmarkDocuments.find((d) => d.id === primary);
      expect(doc).toBeDefined();
      expect(doc!.language).toBe("en");
    }
  });

  it("returns both language variants from expectedDocumentIds for every query", () => {
    for (const query of benchmarkQueries) {
      const ids = expectedDocumentIds(query);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(ids).toContain(`${query.conceptId}-en`);
      expect(ids).toContain(`${query.conceptId}-es`);
    }
  });

  it("calculates same-language and cross-language retrieval metrics locally", () => {
    const documentEmbeddings = basisVectors(benchmarkDocuments.length);
    const queryEmbeddings = benchmarkQueries.map((query) => {
      const documentIndex = benchmarkDocuments.findIndex(
        (document) => document.id === expectedDocumentId(query),
      );
      const embedding = documentEmbeddings[documentIndex];
      if (!embedding) {
        throw new Error(`Missing fixture vector for ${query.id}.`);
      }
      return embedding;
    });

    const metrics = evaluateEmbeddingBenchmark(
      benchmarkDocuments,
      benchmarkQueries,
      documentEmbeddings,
      queryEmbeddings,
    );

    expect(metrics.dimensions).toBe(106);
    expect(metrics.top1Accuracy).toBe(1);
    expect(metrics.top3Accuracy).toBe(1);
    expect(metrics.crossLanguageTop1Accuracy).toBe(1);
    expect(metrics.crossLanguageTop3Accuracy).toBe(1);
    expect(metrics.meanReciprocalRank).toBe(1);
    expect(metrics.recallAt3).toBeGreaterThanOrEqual(0.5);
    expect(metrics.recallAt3).toBeLessThanOrEqual(1);
    expect(metrics.averageRelevantSimilarity).toBe(1);
    expect(metrics.averageDistractorSeparation).toBe(1);
  });

  it("rejects invalid vector shapes rather than reporting misleading metrics", () => {
    expect(() => cosineSimilarity([1, 0], [1])).toThrow("equally sized");
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow("zero vector");
    expect(() =>
      evaluateEmbeddingBenchmark(
        benchmarkDocuments,
        benchmarkQueries,
        basisVectors(benchmarkDocuments.length - 1),
        basisVectors(benchmarkQueries.length),
      ),
    ).toThrow("one document embedding");
  });
});

function basisVectors(count: number): readonly (readonly number[])[] {
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => Number(row === column)),
  );
}
