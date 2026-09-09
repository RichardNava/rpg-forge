import type { VectorRecord } from "@repo/rules-analysis-run";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVectorizeIndex,
  VECTORIZE_UPSERT_BATCH_SIZE,
  VectorIndexUnavailableError,
} from "./vectorize-index.js";

interface StoredVector {
  id: string;
  values: number[];
  namespace: string;
}

function fakeIndex(store = new Map<string, StoredVector>()) {
  const upsertCalls: { records: { id: string; values: number[] }[] }[] = [];
  const deleteCalls: string[][] = [];
  const queryCalls: { vector: number[]; namespace: string; topK: number }[] =
    [];
  const failNextBatchAtIndex = { value: -1 };
  const visible = { value: true };
  const getByIds = async (ids: string[]): Promise<StoredVector[]> =>
    visible.value
      ? ids
          .map((id) => store.get(id))
          .filter((v): v is StoredVector => v !== undefined)
      : [];

  return {
    store,
    upsertCalls,
    deleteCalls,
    queryCalls,
    failNextBatchAtIndex,
    visible,
    index: {
      async upsert(
        records: { id: string; values: number[]; namespace: string }[],
      ) {
        upsertCalls.push({
          records: records.map(({ id, values }) => ({ id, values })),
        });
        if (
          failNextBatchAtIndex.value >= 0 &&
          upsertCalls.length > failNextBatchAtIndex.value
        ) {
          throw new Error("injected upsert failure");
        }
        for (const record of records) {
          store.set(record.id, record);
        }
      },
      async getByIds(ids: string[]): Promise<StoredVector[]> {
        return getByIds(ids);
      },
      async query(
        vector: number[],
        options: { namespace: string; topK: number },
      ) {
        queryCalls.push({
          vector,
          namespace: options.namespace,
          topK: options.topK,
        });
        const matches = [...store.values()]
          .filter((v) => v.namespace === options.namespace)
          .sort(
            (a, b) => score(options.namespace, b) - score(options.namespace, a),
          );
        return {
          count: matches.length,
          matches: matches.slice(0, options.topK).map((v) => ({ id: v.id })),
        };
      },
      async deleteByIds(ids: string[]) {
        deleteCalls.push(ids);
        for (const id of ids) {
          store.delete(id);
        }
        return { count: ids.length, ids: [] };
      },
    },
  };

  function score(namespace: string, v: StoredVector): number {
    return v.namespace === namespace ? 1 : 0;
  }
}

function vectors(ids: readonly string[]): VectorRecord[] {
  return ids.map((id, index) => ({
    id,
    values: [index % 7, (index + 1) % 7, 1, 0],
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vectorize index adapter", () => {
  it("upserts vectors in bounded batches under the namespace", async () => {
    const fake = fakeIndex();
    const adapter = createVectorizeIndex(fake.index as never);
    const records = vectors(
      Array.from(
        { length: VECTORIZE_UPSERT_BATCH_SIZE * 2 + 3 },
        (_, n) => `v-${n}`,
      ),
    );

    await adapter.upsert({ namespace: "gen-a", vectors: records });

    expect(fake.upsertCalls).toHaveLength(3);
    expect(fake.upsertCalls[0]!.records).toHaveLength(
      VECTORIZE_UPSERT_BATCH_SIZE,
    );
    expect(fake.upsertCalls[1]!.records).toHaveLength(
      VECTORIZE_UPSERT_BATCH_SIZE,
    );
    expect(fake.upsertCalls[2]!.records).toHaveLength(3);
    for (const id of records.map((r) => r.id)) {
      expect(fake.store.get(id)?.namespace).toBe("gen-a");
    }
  });

  it("maps a failed upsert to an unavailable error and rolls back written batches", async () => {
    const fake = fakeIndex();
    const adapter = createVectorizeIndex(fake.index as never);
    fake.failNextBatchAtIndex.value = 1;
    const records = vectors(
      Array.from(
        { length: VECTORIZE_UPSERT_BATCH_SIZE * 2 },
        (_, n) => `v-${n}`,
      ),
    );

    await expect(
      adapter.upsert({ namespace: "gen-a", vectors: records }),
    ).rejects.toBeInstanceOf(VectorIndexUnavailableError);

    expect(fake.deleteCalls).toHaveLength(1);
    expect(fake.deleteCalls[0]!).toHaveLength(VECTORIZE_UPSERT_BATCH_SIZE);
    expect(fake.deleteCalls[0]![0]).toBe("v-0");
    expect(fake.store.size).toBe(0);
  });

  it("queries with the namespace and maps matches to ids", async () => {
    const fake = fakeIndex();
    const adapter = createVectorizeIndex(fake.index as never);
    await adapter.upsert({
      namespace: "gen-a",
      vectors: vectors(["a", "b"]),
    });

    const retrieved = await adapter.query({
      namespace: "gen-a",
      vector: [1, 0, 0, 0],
      topK: 2,
    });
    const retrievalCall = fake.queryCalls.at(-1)!;
    expect(retrievalCall.namespace).toBe("gen-a");
    expect(retrievalCall.topK).toBe(2);
    expect(retrieved.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("does not leak retrieved ids across namespaces", async () => {
    const fake = fakeIndex();
    const adapter = createVectorizeIndex(fake.index as never);
    await adapter.upsert({ namespace: "gen-a", vectors: vectors(["a"]) });
    await adapter.upsert({ namespace: "gen-b", vectors: vectors(["b"]) });

    const retrieved = await adapter.query({
      namespace: "gen-a",
      vector: [1, 0, 0, 0],
      topK: 5,
    });
    expect(retrieved.map((v) => v.id)).toEqual(["a"]);
  });

  it("maps a query failure to an unavailable error", async () => {
    const failing = {
      upsert: async () => ({ count: 0, ids: [] }),
      getByIds: async () => [],
      query: async () => {
        throw new Error("index down");
      },
      deleteByIds: async () => ({ count: 0, ids: [] }),
    };
    const adapter = createVectorizeIndex(failing as never);
    await expect(
      adapter.query({ namespace: "n", vector: [1, 0, 0, 0], topK: 1 }),
    ).rejects.toBeInstanceOf(VectorIndexUnavailableError);
  });

  it("deletes by id and treats an empty list as a no-op", async () => {
    const fake = fakeIndex();
    const adapter = createVectorizeIndex(fake.index as never);
    await adapter.deleteByIds({ namespace: "n", ids: [] });
    expect(fake.deleteCalls).toEqual([]);

    await adapter.deleteByIds({ namespace: "n", ids: ["x"] });
    expect(fake.deleteCalls).toEqual([["x"]]);
  });

  it("maps a delete failure to an unavailable error", async () => {
    const failing = {
      upsert: async () => ({ count: 0, ids: [] }),
      getByIds: async () => [],
      query: async () => ({ count: 0, matches: [] }),
      deleteByIds: async () => {
        throw new Error("index down");
      },
    };
    const adapter = createVectorizeIndex(failing as never);
    await expect(
      adapter.deleteByIds({ namespace: "n", ids: ["x"] }),
    ).rejects.toBeInstanceOf(VectorIndexUnavailableError);
  });

  it("waits for vectors to become queryable before returning", async () => {
    const store = new Map<string, StoredVector>();
    let getByIdsReads = 0;
    const delayed = {
      index: {
        async upsert(
          records: { id: string; values: number[]; namespace: string }[],
        ) {
          for (const record of records) {
            store.set(record.id, record);
          }
        },
        async getByIds(ids: string[]): Promise<StoredVector[]> {
          getByIdsReads += 1;
          if (getByIdsReads <= 2) {
            return [];
          }
          return ids
            .map((id) => store.get(id))
            .filter((v): v is StoredVector => v !== undefined);
        },
        async query(
          _vector: number[],
          options: { namespace: string; topK: number },
        ) {
          const ids = [...store.values()]
            .filter((v) => v.namespace === options.namespace)
            .slice(0, options.topK)
            .map((v) => ({ id: v.id }));
          return { count: ids.length, matches: ids };
        },
        async deleteByIds(ids: string[]) {
          for (const id of ids) {
            store.delete(id);
          }
          return { count: ids.length, ids: [] };
        },
      },
    };
    const adapter = createVectorizeIndex(delayed.index as never);

    await adapter.upsert({
      namespace: "gen-d",
      vectors: vectors(["d1"]),
    });

    expect(getByIdsReads).toBe(3);
    expect(store.has("d1")).toBe(true);
  });

  it("aborts the visibility wait and rolls back when the index never reports the vectors", async () => {
    const fake = fakeIndex();
    fake.visible.value = false;
    fake.store.clear();

    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 10_000;
      return now;
    });
    await expect(
      createVectorizeIndex(fake.index as never).upsert({
        namespace: "n",
        vectors: vectors(["w"]),
      }),
    ).rejects.toBeInstanceOf(VectorIndexUnavailableError);
    nowSpy.mockRestore();

    expect(fake.deleteCalls).toEqual([["w"]]);
    expect(fake.store.size).toBe(0);
  });
});
