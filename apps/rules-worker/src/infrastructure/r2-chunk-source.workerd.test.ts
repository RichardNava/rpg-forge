import {
  serializeChunksJsonl,
  type RulebookChunk,
} from "@repo/rulebook-ingestion";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createR2ChunkSource } from "./r2-chunk-source.js";
import { RulebookStorageUnavailableError } from "./r2-rulebook-storage.js";
import { createR2TemporaryRulebookStorage } from "./r2-rulebook-storage.js";

function makeChunk(overrides: Partial<RulebookChunk> = {}): RulebookChunk {
  return {
    version: 1,
    chunkId: crypto.randomUUID(),
    pageStart: 1,
    pageEnd: 1,
    text: "A violent storm keeps the caravan pinned to the coastal road.",
    ...overrides,
  };
}

function bucket(): R2Bucket {
  const bound = env.RULEBOOK_BUCKET as R2Bucket | undefined;
  if (bound === undefined) {
    throw new Error("RULEBOOK_BUCKET binding is missing from env.local config");
  }
  return bound;
}

describe("R2 chunk source", () => {
  it("reads and re-validates the stored chunks.jsonl", async () => {
    const chunks = [makeChunk(), makeChunk({ pageStart: 3, pageEnd: 4 })];
    const storage = createR2TemporaryRulebookStorage(bucket());
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    await storage.putChunks({
      analysisId,
      ingestionId,
      jsonl: serializeChunksJsonl(chunks),
    });

    const read = await createR2ChunkSource(bucket()).readChunks({
      analysisId,
      ingestionId,
    });
    expect(read).toEqual(chunks);
  });

  it("fails closed on a missing chunks object", async () => {
    await expect(
      createR2ChunkSource(bucket()).readChunks({
        analysisId: crypto.randomUUID(),
        ingestionId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RulebookStorageUnavailableError);
  });

  it("fails closed on a corrupt chunk line", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket());
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    await storage.putChunks({
      analysisId,
      ingestionId,
      jsonl:
        '{"version":1,"chunkId":"c1","pageStart":1,"pageEnd":0,"text":""}\n',
    });

    await expect(
      createR2ChunkSource(bucket()).readChunks({
        analysisId,
        ingestionId,
      }),
    ).rejects.toBeInstanceOf(RulebookStorageUnavailableError);
  });
});
