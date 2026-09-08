import type { ExtractionArtifact } from "@repo/rulebook-ingestion";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createR2TemporaryRulebookStorage,
  getRulebookObjectKeys,
  RulebookStorageUnavailableError,
} from "./r2-rulebook-storage.js";

function makeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function* bytesSource(value: Uint8Array): AsyncIterable<Uint8Array> {
  const chunk = 7;
  for (let offset = 0; offset < value.byteLength; offset += chunk) {
    yield value.subarray(offset, Math.min(offset + chunk, value.byteLength));
  }
}

function makeArtifact(
  analysisId: string,
  ingestionId: string,
): ExtractionArtifact {
  return {
    version: 1,
    analysisId,
    ingestionId,
    pageCount: 1,
    pages: [{ pageNumber: 1, text: "A single extracted page." }],
  };
}

describe("R2 temporary rulebook storage", () => {
  let bucket: R2Bucket;

  beforeAll(() => {
    const bound = env.RULEBOOK_BUCKET as R2Bucket | undefined;
    if (bound === undefined) {
      throw new Error(
        "RULEBOOK_BUCKET binding is missing from env.local config",
      );
    }
    bucket = bound;
  });

  it("round-trips raw pdf, extraction, and chunks under generation-isolated keys", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket);
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    const raw = makeBytes("%PDF-1.7 test content");

    await storage.putRaw({
      analysisId,
      ingestionId,
      bytes: bytesSource(raw),
    });
    await storage.putExtraction({
      analysisId,
      ingestionId,
      artifact: makeArtifact(analysisId, ingestionId),
    });
    await storage.putChunks({
      analysisId,
      ingestionId,
      jsonl: '{"chunkId":"c1"}\n',
    });

    const keys = getRulebookObjectKeys(analysisId, ingestionId);
    const rawObject = await bucket.get(keys.rawPdf);
    expect(rawObject).not.toBeNull();
    expect(rawObject!.size).toBe(raw.byteLength);
    expect(await rawObject!.bytes()).toEqual(raw);

    const extractionObject = await bucket.get(keys.extraction);
    expect(extractionObject).not.toBeNull();
    expect(await extractionObject!.text()).toContain(
      "A single extracted page.",
    );

    const chunksObject = await bucket.get(keys.chunks);
    expect(await chunksObject!.text()).toBe('{"chunkId":"c1"}\n');
  });

  it("supports bounded range reads of the raw pdf, loading only the requested window", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket);
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    const raw = makeBytes("%PDF-1.7 this is a longer rulebook payload");
    await storage.putRaw({ analysisId, ingestionId, bytes: bytesSource(raw) });

    const source = await storage.openRaw({ analysisId, ingestionId });
    expect(source.sizeBytes).toBe(raw.byteLength);

    const head = await source.readRange(0, 8);
    expect(head).toEqual(raw.subarray(0, 8));
    expect(head.length).toBe(8);

    const tail = await source.readRange(10, 5);
    expect(tail).toEqual(raw.subarray(10, 15));
  });

  it("rejects invalid range reads fail-closed", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket);
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    await storage.putRaw({
      analysisId,
      ingestionId,
      bytes: bytesSource(makeBytes("abc")),
    });
    const source = await storage.openRaw({ analysisId, ingestionId });
    await expect(source.readRange(-1, 1)).rejects.toBeInstanceOf(
      RulebookStorageUnavailableError,
    );
    await expect(source.readRange(0, 0)).rejects.toBeInstanceOf(
      RulebookStorageUnavailableError,
    );
  });

  it("throws RulebookStorageUnavailableError when the raw object is missing", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket);
    await expect(
      storage.openRaw({
        analysisId: crypto.randomUUID(),
        ingestionId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RulebookStorageUnavailableError);
  });

  it("deleteArtifacts removes only the targeted generation", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket);
    const analysisId = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    await storage.putRaw({
      analysisId,
      ingestionId: first,
      bytes: bytesSource(makeBytes("first")),
    });
    await storage.putRaw({
      analysisId,
      ingestionId: second,
      bytes: bytesSource(makeBytes("second")),
    });

    await storage.deleteArtifacts({ analysisId, ingestionId: first });

    const firstObject = await bucket.get(
      getRulebookObjectKeys(analysisId, first).rawPdf,
    );
    const secondObject = await bucket.get(
      getRulebookObjectKeys(analysisId, second).rawPdf,
    );
    expect(firstObject).toBeNull();
    expect(secondObject).not.toBeNull();
  });
});
