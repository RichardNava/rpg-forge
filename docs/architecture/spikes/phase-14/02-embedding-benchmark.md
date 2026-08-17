# Spike B - Multilingual Embeddings

**Status:** DECISION CLOSED — ADR-053 ACCEPTED
**Date:** 17/08/2026

## Question

Which current Workers AI embedding model should determine the future fixed Vectorize dimensions and cosine metric for English, Spanish, and cross-language rule retrieval?

## Candidates

| Workers AI model                 | Current catalogue evidence                   | Upstream dimensions                        | Context relevant to Workers AI   | Current price                                    | Deprecation state   |
| -------------------------------- | -------------------------------------------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------ | ------------------- |
| `@cf/baai/bge-m3`                | Cloudflare-hosted; multilingual              | 1024 dense dimensions                      | Cloudflare lists 60,000 tokens   | 1,075 Neurons/M input tokens                     | No deprecated badge |
| `@cf/google/embeddinggemma-300m` | Cloudflare-hosted; trained in 100+ languages | 768 default dimensions                     | Upstream card lists 2,048 tokens | Not listed in Cloudflare's current pricing table | No deprecated badge |
| `@cf/qwen/qwen3-embedding-0.6b`  | Cloudflare-hosted; multilingual family       | 1024 maximum/default; MRL can vary 32-1024 | Cloudflare lists 8,192 tokens    | 1,075 Neurons/M input tokens                     | No deprecated badge |

The `bge-m3` upstream model card lists 8,192 sequence length while the Cloudflare catalogue lists 60,000 tokens. The Qwen upstream card lists 32K while Cloudflare lists 8,192. The Cloudflare effective limit and the actual returned dimension must therefore be observed in a real Workers AI response before index creation.

Licensing for model weights is recorded for research only: BGE-M3 is MIT, EmbeddingGemma uses Google's Gemma terms, and Qwen3 Embedding is Apache-2.0. None is a package dependency of this repository.

## Methodology

The local corpus in `spikes/phase-14/embeddings/corpus.ts` contains:

- 10 original English rule passages;
- their 10 Spanish conceptual equivalents;
- 10 original distractors;
- 40 queries: each concept is tested as EN-to-EN, ES-to-ES, EN-to-ES, and ES-to-EN.

`metrics.ts` calculates cosine similarity locally and reports:

- Top-1 accuracy (cross-language queries accept either language variant as a relevant match);
- Top-3 accuracy;
- cross-language Top-1 accuracy (same dual-variant acceptance);
- average best relevant similarity (highest score among both language variants of the matched concept);
- average separation from the strongest distractor (any non-relevant document);
- output dimensions.

The local Vitest suite proves corpus counts, direction coverage, metric calculations, and rejection of malformed vectors. It does not substitute model output for real embeddings.

Each model requires two small batches: one document batch (30 texts) and one query batch (40 texts). The total is six remote embedding operations, below the 20-operation budget. Latency is measured wall-clock around each pair of requests, and dimensions are read from the returned vectors.

## Results

### Benchmark 1 — Basic corpus

Benchmark executed via `pnpm benchmark:embeddings` using a temporary `ai-benchmark` Worker with a remote `[[ai]]` binding on account `a08e5473093b89e74efe67e4773d0ae5`. No secrets were read or stored.

Corpus: 30 documents, 40 queries. All three models scored 100% on every metric. The corpus was too simple to differentiate retrieval quality.

| Metric                       | `@cf/baai/bge-m3` | `@cf/google/embeddinggemma-300m` | `@cf/qwen/qwen3-embedding-0.6b` |
| ---------------------------- | ----------------- | -------------------------------- | ------------------------------- |
| Returned dimensions          | 1024              | 768                              | 1024                            |
| Top-1 accuracy               | 100%              | 100%                             | 100%                            |
| Top-3 accuracy               | 100%              | 100%                             | 100%                            |
| Cross-language Top-1         | 100%              | 100%                             | 100%                            |
| Avg relevant similarity      | 0.6911            | 0.6645                           | 0.6904                          |
| Avg distractor separation    | 0.2058            | 0.2726                           | 0.2006                          |
| Total latency (docs+queries) | 1870 ms           | 705 ms                           | 6969 ms                         |

Total Workers AI usage: 6 API calls. Approximate cost: ~27 Neurons.

### Benchmark 2 — Hard corpus (B.2)

Benchmark executed via the same `pnpm benchmark:embeddings` command against the same remote binding. Corpus expanded to 106 documents and 208 queries with near-duplicates, negation, exceptions, numeric distinctions, terminology mismatch, multi-condition rules, nested exceptions, cross-language paraphrases, and high-overlap distractors.

Total Workers AI usage: 6 API calls (2 per model × 3 models). Approximate cost: ~140 Neurons, within the 10,000 daily free allocation.

| Metric                       | `@cf/baai/bge-m3` | `@cf/google/embeddinggemma-300m` | `@cf/qwen/qwen3-embedding-0.6b` |
| ---------------------------- | ----------------- | -------------------------------- | ------------------------------- |
| Returned dimensions          | 1024              | 768                              | 1024                            |
| Top-1 accuracy               | 78.8%             | **87.5%**                        | 76.0%                           |
| Top-3 accuracy               | 98.1%             | **99.0%**                        | 94.2%                           |
| Cross-language Top-1         | 78.8%             | **87.5%**                        | 76.0%                           |
| Cross-language Top-3         | 98.1%             | **99.0%**                        | 94.2%                           |
| Mean Reciprocal Rank (MRR)   | 0.8830            | **0.9247**                       | 0.8559                          |
| Recall@3                     | 0.7885            | **0.8365**                       | 0.6731                          |
| Avg relevant similarity      | 0.6788            | 0.6670                           | **0.7156**                      |
| Avg distractor separation    | 0.0687            | **0.0972**                       | 0.0680                          |
| Total latency (docs+queries) | 1661 ms           | 3170 ms                          | 12152 ms                        |

## Decision

The hard corpus is meaningfully discriminative. `@cf/google/embeddinggemma-300m` leads on every retrieval-quality metric:

1. **Top-1 accuracy**: 87.5% vs 78.8% (bge-m3) vs 76.0% (qwen3). EmbeddingGemma has a 8.7 percentage-point lead over the next-best model.
2. **Cross-language Top-1**: 87.5% vs 78.8% vs 76.0%. The same margin holds for cross-language retrieval.
3. **MRR**: 0.9247 vs 0.8830 vs 0.8559. EmbeddingGemma ranks the correct document higher on average.
4. **Recall@3**: 0.8365 vs 0.7885 vs 0.6731. EmbeddingGemma retrieves more relevant documents in the top-3.
5. **Distractor separation**: 0.0972 vs 0.0687 vs 0.0680. EmbeddingGemma creates the largest gap between relevant and irrelevant documents.

BGE-M3 has the lowest latency (1661ms) but significantly lower retrieval quality. Qwen3 has the highest latency (12152ms) and the lowest retrieval quality across the board.

EmbeddingGemma's latency (3170ms) is acceptable for the MVP use case where embeddings are generated during resource creation, not on every request.

The lower dimensionality (768 vs 1024) is a secondary benefit: smaller Vectorize indexes, lower storage cost, and faster approximate-neighbor search.

```text
EMBEDDING_MODEL = @cf/google/embeddinggemma-300m
EMBEDDING_DIMENSIONS = 768
VECTOR_METRIC = cosine
```

EmbeddingGemma is proposed because it wins on retrieval correctness (priority 1), cross-language correctness (priority 2), and distractor resistance (priority 3), while also offering the lowest dimensionality (priority 5). Its latency (priority 4) is within acceptable bounds for the MVP.

Cosine is validated as the evaluation metric and proposed as the Vectorize metric. No Vectorize index has been created yet.

The future command is documented but must not be run until human approval:

```sh
# DO NOT RUN: awaiting human approval of the selected model.
wrangler vectorize create rpg-forge-rules --dimensions=768 --metric=cosine
```

## Confidence

**High** that the benchmark is discriminative and the evidence supports a model selection. **High** that `@cf/google/embeddinggemma-300m` is the best choice for the MVP based on retrieval quality and dimensionality.

## Follow-up

1. Obtain human approval of the proposed `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, and `VECTOR_METRIC`.
2. Write an Accepted ADR recording the decision and evidence.
3. Create a Vectorize index with the verified immutable dimensions and metric.
4. Implement the embedding pipeline using the selected model.

## Sources

- https://developers.cloudflare.com/workers-ai/models/bge-m3/
- https://developers.cloudflare.com/workers-ai/models/embeddinggemma-300m/
- https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/vectorize/best-practices/create-indexes/
- https://huggingface.co/BAAI/bge-m3
- https://huggingface.co/google/embeddinggemma-300m
- https://huggingface.co/Qwen/Qwen3-Embedding-0.6B