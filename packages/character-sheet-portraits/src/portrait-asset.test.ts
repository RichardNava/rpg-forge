import { describe, expect, it } from "vitest";
import {
  getPortraitAssetKeys,
  getSessionPortraitPrefix,
  portraitPathSegment,
  type CharacterSheetPortraitAssetStore,
  type PutPortraitAssetInput,
} from "./index.ts";
import { PortraitAssetError } from "./portrait-asset.ts";

class InMemoryPortraitStore implements CharacterSheetPortraitAssetStore {
  private readonly assets = new Map<
    string,
    { metadata: Record<string, unknown>; imageBytes: Uint8Array }
  >();

  private key(sessionId: string, assetId: string): string {
    return `${sessionId}/${assetId}`;
  }

  async putAsset(input: PutPortraitAssetInput) {
    const metadata = {
      schemaVersion: "1" as const,
      assetId: input.assetId,
      sessionId: input.sessionId,
      source: input.source,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
    };
    this.assets.set(this.key(input.sessionId, input.assetId), {
      metadata,
      imageBytes: input.imageBytes.slice(),
    });
    return metadata;
  }

  async getAsset(identity: { sessionId: string; assetId: string }) {
    const row = this.assets.get(this.key(identity.sessionId, identity.assetId));
    if (row === undefined) return null;
    return {
      metadata: {
        schemaVersion: "1" as const,
        assetId: identity.assetId,
        sessionId: identity.sessionId,
        source: row.metadata.source as "upload" | "url" | "ai",
        mimeType: row.metadata.mimeType as "image/png" | "image/jpeg",
        sizeBytes: row.metadata.sizeBytes as number,
        width: row.metadata.width as number | null,
        height: row.metadata.height as number | null,
      },
      imageBytes: row.imageBytes.slice(),
    };
  }

  async deleteAsset(identity: { sessionId: string; assetId: string }): Promise<void> {
    this.assets.delete(this.key(identity.sessionId, identity.assetId));
  }

  async deleteSessionAssets(sessionId: string): Promise<void> {
    for (const key of [...this.assets.keys()]) {
      if (key.startsWith(`${sessionId}/`)) this.assets.delete(key);
    }
  }
}

describe("portrait asset keys", () => {
  it("scopes assets under the session portraits tenant", () => {
    expect(getSessionPortraitPrefix("sess-1")).toBe(
      "temp/character-sheets/v1/sessions/sess-1/portraits/",
    );
    expect(getPortraitAssetKeys("sess-1", "asset-1")).toEqual({
      image: "temp/character-sheets/v1/sessions/sess-1/portraits/asset-1/image",
      metadata: "temp/character-sheets/v1/sessions/sess-1/portraits/asset-1/metadata.json",
    });
  });

  it("rejects traversal segments", () => {
    expect(() => portraitPathSegment("../x", "assetId")).toThrow(PortraitAssetError);
    expect(() => portraitPathSegment("a/b", "assetId")).toThrow(PortraitAssetError);
    expect(() => portraitPathSegment("", "assetId")).toThrow(PortraitAssetError);
  });
});

describe("CharacterSheetPortraitAssetStore contract", () => {
  it("round-trips an asset and cleans up by session", async () => {
    const store = new InMemoryPortraitStore();
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const metadata = await store.putAsset({
      sessionId: "sess-1",
      assetId: "asset-1",
      source: "upload",
      mimeType: "image/png",
      sizeBytes: imageBytes.length,
      width: 1,
      height: 1,
      imageBytes,
    });
    expect(metadata.assetId).toBe("asset-1");
    expect(metadata.source).toBe("upload");

    const read = await store.getAsset({ sessionId: "sess-1", assetId: "asset-1" });
    expect(read?.metadata).toEqual(metadata);
    expect([...(read?.imageBytes ?? [])]).toEqual([...imageBytes]);

    // Cross-session isolation: same asset id in another session is absent.
    expect(await store.getAsset({ sessionId: "sess-2", assetId: "asset-1" })).toBeNull();

    await store.deleteAsset({ sessionId: "sess-1", assetId: "asset-1" });
    expect(await store.getAsset({ sessionId: "sess-1", assetId: "asset-1" })).toBeNull();
  });

  it("deleteSessionAssets sweeps one session only", async () => {
    const store = new InMemoryPortraitStore();
    const put = (sessionId: string, assetId: string) =>
      store.putAsset({
        sessionId,
        assetId,
        source: "url",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        width: 1,
        height: 1,
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      });
    await put("sess-1", "a1");
    await put("sess-1", "a2");
    await put("sess-2", "a1");
    await store.deleteSessionAssets("sess-1");
    expect(await store.getAsset({ sessionId: "sess-1", assetId: "a1" })).toBeNull();
    expect(await store.getAsset({ sessionId: "sess-1", assetId: "a2" })).toBeNull();
    expect(await store.getAsset({ sessionId: "sess-2", assetId: "a1" })).not.toBeNull();
  });

  it("missing reads return null, not errors", async () => {
    const store = new InMemoryPortraitStore();
    expect(await store.getAsset({ sessionId: "missing", assetId: "missing" })).toBeNull();
  });
});
