import { EMBEDDING_BATCH_SIZE } from "@repo/rules-analysis-run";
import { describe, expect, it } from "vitest";
import {
  createCloudflareAiEmbeddings,
  RULES_EMBEDDING_MODEL,
} from "./ai-embeddings.js";
import { AiProviderUnavailableError } from "./ai-errors.js";

interface FakeAi {
  readonly calls: Array<{ model: string; input: unknown }>;
  result: unknown;
  error?: Error;
}

function fakeAi(): FakeAi {
  const state: FakeAi = {
    calls: [],
    result: undefined,
  };
  return state;
}

function embeddable(ai: FakeAi) {
  return {
    handler: {
      async run(model: string, input: unknown) {
        ai.calls.push({ model, input });
        if (ai.error !== undefined) {
          throw ai.error;
        }
        return ai.result;
      },
    } as unknown as Ai,
    calls: ai.calls,
  };
}

function vectorRow(): number[] {
  return Array.from({ length: 768 }, (_, i) => (i % 5) / 5);
}

describe("createCloudflareAiEmbeddings", () => {
  it("embeds texts and forwards the configured model with a batched input", async () => {
    const ai = fakeAi();
    ai.result = {
      shape: [2, 768],
      data: [vectorRow(), vectorRow()],
    };
    const { handler, calls } = embeddable(ai);

    const result = await createCloudflareAiEmbeddings(handler).embed([
      "first",
      "second",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(768);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(RULES_EMBEDDING_MODEL);
    expect(calls[0]?.input).toEqual({ text: ["first", "second"] });
  });

  it("returns an empty vector set without calling the provider", async () => {
    const ai = fakeAi();
    const { handler, calls } = embeddable(ai);
    const result = await createCloudflareAiEmbeddings(handler).embed([]);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when a caller exceeds the batch bound", async () => {
    const ai = fakeAi();
    const { handler, calls } = embeddable(ai);
    const texts = Array.from(
      { length: EMBEDDING_BATCH_SIZE + 1 },
      (_, i) => `t${i}`,
    );
    await expect(
      createCloudflareAiEmbeddings(handler).embed(texts),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it("maps a provider failure to an unavailable error", async () => {
    const ai = fakeAi();
    ai.error = new Error("provider down");
    const { handler } = embeddable(ai);
    await expect(
      createCloudflareAiEmbeddings(handler).embed(["x"]),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
  });

  it("rejects malformed provider output shapes", async () => {
    const cases: unknown[] = [
      undefined,
      null,
      "text",
      { data: "not-an-array" },
      { shape: [1, 768], data: [] },
      { shape: [2, 768], data: [vectorRow()] },
      { shape: [1, 767], data: [vectorRow()] },
      {
        shape: [1, 768],
        data: [[1, 2, 3]],
      },
      {
        shape: [1, 768],
        data: [["x", ...vectorRow().slice(1)]],
      },
      {
        shape: [1, 768],
        data: [[Number.NaN, ...vectorRow().slice(1)]],
      },
    ];
    for (const malformed of cases) {
      const ai = fakeAi();
      ai.result = malformed;
      const { handler } = embeddable(ai);
      await expect(
        createCloudflareAiEmbeddings(handler).embed(["x"]),
      ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    }
  });
});
