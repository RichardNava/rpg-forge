import {
  getPortraitAssetKeys,
  getSessionPortraitPrefix,
  parseStoredPortraitMetadata,
  portraitAssetError,
  serializePortraitMetadata,
  type CharacterSheetPortraitAssetStore,
  type PortraitAssetIdentity,
  type PortraitAssetMetadata,
  type PutPortraitAssetInput,
} from "@repo/character-sheet-portraits";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";

const IMAGE_CONTENT_TYPES = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
} as const;
const METADATA_CONTENT_TYPE = "application/json; charset=utf-8";
const CACHE_CONTROL_NO_STORE = "no-store";

const R2_DELETE_BATCH_MAX = 1_000;

async function deleteAllBelowPrefix(
  bucket: R2BucketLike,
  prefix: string,
): Promise<void> {
  let cursor: string | undefined;
  try {
    do {
      const page = await bucket.list({
        prefix,
        limit: R2_DELETE_BATCH_MAX,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) {
        await bucket.delete(keys);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
  } catch {
    throw portraitAssetError(
      "cleanup_failed",
      "Failed to delete character sheet portrait assets.",
    );
  }
}

/**
 * R2-backed temporary session-scoped portrait assets. Stored under
 * `temp/character-sheets/v1/sessions/<session>/portraits/<asset>/` with
 * `image` bytes plus `metadata.json`, so run artifacts, draft snapshots and
 * portrait assets never share keys while one session-prefix sweep cleans all
 * three. Reads re-validate stored metadata; failures surface as typed asset
 * errors. No portrait bytes ever reach D1.
 */
export function createR2CharacterSheetPortraitAssetStore(
  bucket: R2BucketLike,
): CharacterSheetPortraitAssetStore {
  return {
    async putAsset(input: PutPortraitAssetInput): Promise<PortraitAssetMetadata> {
      const keys = getPortraitAssetKeys(input.sessionId, input.assetId);
      const metadata: PortraitAssetMetadata = {
        schemaVersion: "1",
        assetId: input.assetId,
        sessionId: input.sessionId,
        source: input.source,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
      };
      const payload = serializePortraitMetadata(metadata);
      try {
        await bucket.put(keys.metadata, payload, {
          httpMetadata: {
            contentType: METADATA_CONTENT_TYPE,
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
        await bucket.put(keys.image, input.imageBytes, {
          httpMetadata: {
            contentType: IMAGE_CONTENT_TYPES[input.mimeType],
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
      } catch (error) {
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code: string }).code === "invalid_asset_identity"
        ) {
          throw error;
        }
        try {
          await deleteAllBelowPrefix(
            bucket,
            getSessionPortraitPrefix(input.sessionId) +
              `${encodeURIComponent(input.assetId)}/`,
          );
        } catch {
          throw portraitAssetError(
            "cleanup_failed",
            "Character sheet portrait compensation cleanup failed.",
          );
        }
        throw portraitAssetError(
          "storage_unavailable",
          "Character sheet portrait storage is unavailable.",
        );
      }
      return metadata;
    },

    async getAsset(identity: PortraitAssetIdentity) {
      const keys = getPortraitAssetKeys(identity.sessionId, identity.assetId);
      let metadataPayload: string | null = null;
      let imageBytes: Uint8Array | null = null;
      try {
        const metadataObject = await bucket.get(keys.metadata);
        if (metadataObject === null) return null;
        metadataPayload = await metadataObject.text();
        const imageObject = await bucket.get(keys.image);
        if (imageObject === null) return null;
        imageBytes = await imageObject.bytes();
      } catch {
        throw portraitAssetError(
          "storage_unavailable",
          "Character sheet portrait storage is unavailable.",
        );
      }
      const metadata = parseStoredPortraitMetadata(metadataPayload);
      if (metadata === null) {
        throw portraitAssetError(
          "corrupt_metadata",
          "The stored portrait metadata failed validation.",
        );
      }
      if (
        metadata.sessionId !== identity.sessionId ||
        metadata.assetId !== identity.assetId
      ) {
        throw portraitAssetError(
          "corrupt_metadata",
          "The stored portrait metadata does not match its key.",
        );
      }
      return { metadata, imageBytes: imageBytes! };
    },

    async deleteAsset(identity: PortraitAssetIdentity): Promise<void> {
      const keys = getPortraitAssetKeys(identity.sessionId, identity.assetId);
      try {
        await bucket.delete([keys.image, keys.metadata]);
      } catch {
        throw portraitAssetError(
          "cleanup_failed",
          "Failed to delete the character sheet portrait asset.",
        );
      }
    },

    async deleteSessionAssets(sessionId: string): Promise<void> {
      await deleteAllBelowPrefix(bucket, getSessionPortraitPrefix(sessionId));
    },
  };
}
