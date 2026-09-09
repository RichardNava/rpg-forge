import {
  type RetrievedVector,
  type RuleVectorIndexPort,
  type VectorRecord,
} from "@repo/rules-analysis-run";

export class VectorIndexUnavailableError extends Error {
  constructor() {
    super("The vector index is unavailable.");
    this.name = "VectorIndexUnavailableError";
  }
}

/**
 * Vectorize per-call mutation bound. The analysis domain can produce up to
 * MAX_RULEBOOK_CHUNKS vectors, so upserts are split into bounded batches and
 * rolled back best-effort if a later batch fails (ids are deterministic, so a
 * rolled-back batch is fully enumerable).
 */
export const VECTORIZE_UPSERT_BATCH_SIZE = 500;

/**
 * Bounded, non-busy-loop visibility window. Vectorize applies upserts
 * asynchronously in production; a query that lands before the mutation applies
 * can miss freshly inserted vectors. The adapter therefore waits after upsert
 * with:
 *
 * - a single shared deadline (VECTORIZE_VISIBILITY_MAX_WAIT_MS) across all upsert
 *   batches;
 * - a cheap query probe (topK = 1, no values/metadata) as a propagation signal:
 *   once any just-upserted id is queryable, each batch (<=
 *   VECTORIZE_UPSERT_BATCH_SIZE ids) is confirmed exactly with getByIds;
 * - exponential backoff from VECTORIZE_VISIBILITY_POLL_MS up to
 *   VECTORIZE_VISIBILITY_MAX_INTERVAL_MS, so propagation lulls are not hot-polled;
 * - fail-closed behavior: on timeout or after the max number of confirmation
 *   reads, the previously written vectors are rolled back best-effort and the
 *   run surfaces VectorIndexUnavailableError.
 *
 * Amplification is bounded: a normal success performs one topK=1 probe plus one
 * getByIds read of <= VECTORIZE_UPSERT_BATCH_SIZE ids per batch; the pathological
 * case repeats the bounded getByIds confirmation for a lagging batch until the
 * shared deadline.
 */
export const VECTORIZE_VISIBILITY_POLL_MS = 500;
export const VECTORIZE_VISIBILITY_MAX_INTERVAL_MS = 4_000;
export const VECTORIZE_VISIBILITY_MAX_WAIT_MS = 30_000;
export const VECTORIZE_VISIBILITY_PROBE_TOP_K = 1;

/**
 * Shared Vectorize index adapter. The run domain guarantees every call carries
 * a namespace (the ingestionId), so vectors from different generations / runs
 * never leak into each other's retrieval.
 */
export function createVectorizeIndex(
  index: VectorizeIndex,
): RuleVectorIndexPort {
  return {
    async upsert(input) {
      const batches = chunkVectors(input.vectors, VECTORIZE_UPSERT_BATCH_SIZE);
      const written = new Set<string>();
      try {
        for (const batch of batches) {
          const records = batch.map((vector) => ({
            id: vector.id,
            values: vector.values,
            namespace: input.namespace,
          }));
          await index.upsert(records);
          batch.forEach((vector) => written.add(vector.id));
        }
        await waitForVisibility(index, input.namespace, input.vectors);
      } catch {
        await bestEffortRollback(index, written);
        throw new VectorIndexUnavailableError();
      }
    },

    async query(input) {
      try {
        const matches = await index.query([...input.vector], {
          namespace: input.namespace,
          topK: input.topK,
          returnValues: false,
          returnMetadata: false,
        });
        return matches.matches.map((match): RetrievedVector => ({
          id: match.id,
        }));
      } catch {
        throw new VectorIndexUnavailableError();
      }
    },

    async deleteByIds(input) {
      if (input.ids.length === 0) {
        return;
      }
      try {
        await index.deleteByIds([...input.ids]);
      } catch {
        throw new VectorIndexUnavailableError();
      }
    },
  };
}

function chunkVectors(
  vectors: readonly VectorRecord[],
  size: number,
): readonly (readonly VectorRecord[])[] {
  const chunks: VectorRecord[][] = [];
  for (let offset = 0; offset < vectors.length; offset += size) {
    chunks.push(vectors.slice(offset, offset + size));
  }
  return chunks;
}

async function waitForVisibility(
  index: VectorizeIndex,
  namespace: string,
  vectors: readonly VectorRecord[],
): Promise<void> {
  const batches = chunkVectors(vectors, VECTORIZE_UPSERT_BATCH_SIZE);
  const allIds = new Set(batches.flatMap((batch) => batch.map((v) => v.id)));
  const probe = vectors[0];
  const deadline = Date.now() + VECTORIZE_VISIBILITY_MAX_WAIT_MS;
  for (const batch of batches) {
    await waitForBatchVisibility(
      index,
      namespace,
      batch.map((vector) => vector.id),
      allIds,
      probe,
      deadline,
    );
  }
}

async function waitForBatchVisibility(
  index: VectorizeIndex,
  namespace: string,
  ids: readonly string[],
  allIds: ReadonlySet<string>,
  probe: VectorRecord | undefined,
  deadline: number,
): Promise<void> {
  let interval = VECTORIZE_VISIBILITY_POLL_MS;
  while (Date.now() < deadline) {
    if (await propagationSignal(index, namespace, allIds, probe)) {
      if (await allPresent(index, ids)) {
        return;
      }
    }
    await delay(interval);
    interval = Math.min(interval * 2, VECTORIZE_VISIBILITY_MAX_INTERVAL_MS);
  }
  throw new VectorIndexUnavailableError();
}

async function propagationSignal(
  index: VectorizeIndex,
  namespace: string,
  allIds: ReadonlySet<string>,
  probe: VectorRecord | undefined,
): Promise<boolean> {
  if (probe === undefined) {
    return true;
  }
  try {
    const result = await index.query([...probe.values], {
      namespace,
      topK: VECTORIZE_VISIBILITY_PROBE_TOP_K,
      returnValues: false,
      returnMetadata: false,
    });
    return result.matches.some((match) => allIds.has(match.id));
  } catch {
    return false;
  }
}

async function allPresent(
  index: VectorizeIndex,
  ids: readonly string[],
): Promise<boolean> {
  try {
    const records = await index.getByIds([...ids]);
    const present = new Set(records.map((record) => record.id));
    return ids.every((id) => present.has(id));
  } catch {
    return false;
  }
}

async function bestEffortRollback(
  index: VectorizeIndex,
  written: ReadonlySet<string>,
): Promise<void> {
  if (written.size === 0) {
    return;
  }
  try {
    await index.deleteByIds([...written]);
  } catch {
    // Rollback is best-effort; the original failure is the one we surface.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
