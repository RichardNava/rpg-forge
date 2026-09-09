import { webCrypto } from "@repo/rules-analysis-session";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createR2RulebookFileHash } from "./r2-rulebook-file-hash.js";
import { RulebookStorageUnavailableError } from "./r2-rulebook-storage.js";
import { createR2TemporaryRulebookStorage } from "./r2-rulebook-storage.js";

async function* bytesSource(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield value;
}

function bucket(): R2Bucket {
  const bound = env.RULEBOOK_BUCKET as R2Bucket | undefined;
  if (bound === undefined) {
    throw new Error("RULEBOOK_BUCKET binding is missing from env.local config");
  }
  return bound;
}

describe("R2 rulebook file hash", () => {
  it("hashes the stored raw pdf with sha256", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket());
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    const raw = new TextEncoder().encode("%PDF-1.7 versioned rulebook body");
    await storage.putRaw({
      analysisId,
      ingestionId,
      bytes: bytesSource(raw),
    });

    const hash = await createR2RulebookFileHash(bucket()).hashRulebookRaw({
      analysisId,
      ingestionId,
    });
    const expected = await webCrypto.sha256Hex(raw);
    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when the raw pdf is missing", async () => {
    await expect(
      createR2RulebookFileHash(bucket()).hashRulebookRaw({
        analysisId: crypto.randomUUID(),
        ingestionId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RulebookStorageUnavailableError);
  });

  it("fails closed on an empty raw pdf", async () => {
    const storage = createR2TemporaryRulebookStorage(bucket());
    const analysisId = crypto.randomUUID();
    const ingestionId = crypto.randomUUID();
    await storage.putRaw({
      analysisId,
      ingestionId,
      bytes: bytesSource(new Uint8Array(0)),
    });

    await expect(
      createR2RulebookFileHash(bucket()).hashRulebookRaw({
        analysisId,
        ingestionId,
      }),
    ).rejects.toBeInstanceOf(RulebookStorageUnavailableError);
  });
});
