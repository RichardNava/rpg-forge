# ADR-053 — Embedding model, dimensions, and Vectorize metric

**Status:** Accepted
**Date:** 17/08/2026

## Context

RPG Forge needs a fixed embedding model, vector dimensionality, and similarity metric for the future Vectorize index that powers multilingual rule retrieval (English and Spanish).

Two benchmarks were executed against the same Cloudflare account using a temporary `ai-benchmark` Worker with a remote `[[ai]]` binding. No secrets were read or stored. No Vectorize index was created.

### Benchmark 1 — Basic corpus

30 documents (10 EN rules + 10 ES rules + 10 distractors), 40 queries (EN→EN, ES→ES, EN→ES, ES→EN per concept). All three candidates scored 100% on every metric. The corpus was too simple to differentiate retrieval quality.

| Metric               | `@cf/baai/bge-m3` | `@cf/google/embeddinggemma-300m` | `@cf/qwen/qwen3-embedding-0.6b` |
| -------------------- | ----------------- | -------------------------------- | ------------------------------- |
| Dimensions           | 1024              | 768                              | 1024                            |
| Top-1                | 100%              | 100%                             | 100%                            |
| Top-3                | 100%              | 100%                             | 100%                            |
| Cross-language Top-1 | 100%              | 100%                             | 100%                            |
| Latency              | 1870 ms           | 705 ms                           | 6969 ms                         |

### Benchmark 2 — Hard corpus

106 documents (38 EN rules + 38 ES rules + 30 high-overlap distractors), 208 queries including paraphrased, cross-language, negation, exception, numeric-distinction, terminology-mismatch, multi-condition, and nested-exception cases. The corpus was discriminative.

| Metric                | `@cf/baai/bge-m3` | `@cf/google/embeddinggemma-300m` | `@cf/qwen/qwen3-embedding-0.6b` |
| --------------------- | ----------------- | -------------------------------- | ------------------------------- |
| Dimensions            | 1024              | 768                              | 1024                            |
| Top-1                 | 78.8%             | **87.5%**                        | 76.0%                           |
| Top-3                 | 98.1%             | **99.0%**                        | 94.2%                           |
| Cross-language Top-1  | 78.8%             | **87.5%**                        | 76.0%                           |
| Cross-language Top-3  | 98.1%             | **99.0%**                        | 94.2%                           |
| MRR                   | 0.883             | **0.925**                        | 0.856                           |
| Recall@3              | 0.789             | **0.837**                        | 0.673                           |
| Distractor separation | 0.069             | **0.097**                        | 0.068                           |
| Latency               | **1661 ms**       | 3170 ms                          | 12152 ms                        |

Total remote operations: 12 (6 per benchmark × 2 benchmarks), within the 20-operation budget.

## Decision

```text
EMBEDDING_MODEL = @cf/google/embeddinggemma-300m
EMBEDDING_DIMENSIONS = 768
VECTOR_METRIC = cosine
```

### Why EmbeddingGemma wins

EmbeddingGemma leads on every retrieval-quality metric in the hard corpus:

1. **Top-1 accuracy**: 87.5% vs 78.8% (bge-m3) vs 76.0% (qwen3). An 8.7 percentage-point margin over the next-best model.
2. **Cross-language Top-1**: 87.5% vs 78.8% vs 76.0%. The same margin holds for cross-language retrieval, which is the core product requirement.
3. **MRR**: 0.925 vs 0.883 vs 0.856. EmbeddingGemma consistently ranks the correct document higher.
4. **Recall@3**: 0.837 vs 0.789 vs 0.673. EmbeddingGemma retrieves more relevant documents in the top-3.
5. **Distractor separation**: 0.097 vs 0.069 vs 0.068. EmbeddingGemma creates the largest gap between relevant and irrelevant documents, critical for near-duplicate and high-overlap distractor resistance.
6. **Dimensionality**: 768 vs 1024. Smaller vectors mean lower Vectorize storage cost and faster approximate-neighbor search.

### Why bge-m3 is rejected

BGE-M3 has the lowest latency (1661 ms) but significantly lower retrieval quality across every metric. The 8.7 percentage-point Top-1 deficit on the hard corpus is not explained by latency; it reflects weaker semantic discrimination for the RPG-rule domain. The 1024-dimensional vectors are 33% larger than EmbeddingGemma's with no quality benefit.

### Why qwen3-embedding-0.6b is rejected

Qwen3 has the highest latency (12152 ms, 3.8× slower than EmbeddingGemma) and the lowest retrieval quality on every metric. Its 1024-dimensional vectors offer no advantage. The latency is unacceptable even for resource-creation-time embedding.

### Why cosine

Cosine similarity is the standard metric for dense vector retrieval, validated locally across both benchmarks. It is invariant to vector magnitude, which aligns with normalized embedding outputs from all three models. Vectorize supports cosine natively.

## Consequences

- The Vectorize index must be created with `--dimensions=768 --metric=cosine` and cannot be changed after creation.
- All embedding calls in production must use `@cf/google/embeddinggemma-300m`.
- The benchmark corpus and scripts in `spikes/phase-14/embeddings/` remain available for future re-evaluation if model pricing or availability changes.
- No Vectorize index has been created yet; creation awaits human authorization.

## Related ADRs

- ADR-012 — Workers AI binding + abstraction
- ADR-016 — MVP persistence boundary