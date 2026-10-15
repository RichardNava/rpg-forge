import { describe, expect, it } from "vitest";
import { getPortraitAssetKeys } from "@repo/character-sheet-portraits";
import { createR2CharacterSheetPortraitAssetStore } from "./r2-character-sheet-portraits.js";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string; cacheControl?: string }
  >();

  async put(
    key: string,
    value: string | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown> {
    this.objects.set(key, {
      bytes: typeof value === "string" ? new TextEncoder().encode(value) : value.slice(),
      contentType: options?.httpMetadata?.contentType,
      cacheControl: options?.httpMetadata?.cacheControl,
    });
    return {};
  }

  async get(key: string) {
    const row = this.objects.get(key);
    if (row === undefined) return null;
    return {
      text: async () => new TextDecoder().decode(row.bytes),
      bytes: async () => row.bytes.slice(),
    };
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter((key) =>
      options?.prefix === undefined ? true : key.startsWith(options.prefix),
    );
    return { objects: keys.map((key) => ({ key })), truncated: false as const };
  }

  async delete(key: string | string[]): Promise<void> {
    for (const single of Array.isArray(key) ? key : [key]) {
      this.objects.delete(single);
    }
  }
}

describe("R2 character sheet portrait asset store", () => {
  const sessionId = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
  const assetId = "c2d5c4e1-1b0a-4c2d-8e4f-2a8b9c0d1e2f";

  it("round-trips image bytes with validated metadata and correct headers", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetPortraitAssetStore(bucket);

    const metadata = await store.putAsset({
      sessionId,
      assetId,
      source: "upload",
      mimeType: "image/png",
      sizeBytes: IMAGE.length,
      width: 1,
      height: 1,
      imageBytes: IMAGE,
    });
    expect(metadata).toMatchObject({ assetId, sessionId, source: "upload", mimeType: "image/png" });

    const read = await store.getAsset({ sessionId, assetId });
    expect(read?.metadata).toEqual(metadata);
    expect([...(read?.imageBytes ?? [])]).toEqual([...IMAGE]);

    const keys = getPortraitAssetKeys(sessionId, assetId);
    expect(bucket.objects.get(keys.image)?.contentType).toBe("image/png");
    expect(bucket.objects.get(keys.image)?.cacheControl).toBe("no-store");
    expect(bucket.objects.get(keys.metadata)?.contentType).toBe("application/json; charset=utf-8");
  });

  it("returns null for a missing asset", async () => {
    const store = createR2CharacterSheetPortraitAssetStore(new FakeR2Bucket());
    expect(await store.getAsset({ sessionId, assetId })).toBeNull();
  });

  it("rejects traversal identities before any storage call", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetPortraitAssetStore(bucket);
    await expect(
      store.putAsset({
        sessionId: "..",
        assetId,
        source: "upload",
        mimeType: "image/png",
        sizeBytes: 1,
        width: 1,
        height: 1,
        imageBytes: IMAGE,
      }),
    ).rejects.toMatchObject({ code: "invalid_asset_identity" });
    expect(bucket.objects.size).toBe(0);
  });

  it("cleans the session portrait subtree without touching runs", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetPortraitAssetStore(bucket);
    await store.putAsset({
      sessionId,
      assetId,
      source: "ai",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      width: 1,
      height: 1,
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    bucket.objects.set("temp/character-sheets/v1/sessions/sess-keep/runs/r1/sheet.pdf", {
      bytes: new Uint8Array([1]),
    });
    await store.deleteSessionAssets(sessionId);
    expect(await store.getAsset({ sessionId, assetId })).toBeNull();
    expect(bucket.objects.size).toBe(1);
  });
});
