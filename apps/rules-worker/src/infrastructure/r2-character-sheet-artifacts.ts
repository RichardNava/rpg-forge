import {
  CharacterSheetArtifactError,
  artifactError,
  getRunArtifactPrefix,
  getRunArtifactKeys,
  getSessionArtifactPrefix,
  parseStoredSpec,
  serializeSpec,
  type CharacterSheetArtifactIdentity,
  type CharacterSheetArtifactStore,
} from "@repo/character-sheet-artifacts";

/**
 * Narrow R2 shape the adapter depends on. Keeps the adapter testable with a
 * fake bucket while remaining structurally compatible with the real R2Bucket.
 * Notably absent: any arbitrary-key or range API, so the adapter cannot grow
 * generic storage access beyond the character-sheet artifact contract.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: string | Uint8Array,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    },
  ): Promise<unknown>;
  get(
    key: string,
  ): Promise<{ text(): Promise<string>; bytes(): Promise<Uint8Array> } | null>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string | string[]): Promise<void>;
}

const R2_DELETE_BATCH_MAX = 1_000;

const SPEC_CONTENT_TYPE = "application/json; charset=utf-8";
const PDF_CONTENT_TYPE = "application/pdf";
const CACHE_CONTROL_NO_STORE = "no-store";

/**
 * Deletes every object under an exact prefix (trailing slash included), page
 * by page, until none remain. Idempotent: an empty prefix deletes nothing.
 * Any list/delete failure surfaces as `cleanup_failed`.
 */
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
    throw artifactError(
      "cleanup_failed",
      "Failed to delete character sheet artifacts.",
    );
  }
}

/**
 * R2-backed temporary character-sheet run artifacts. Stored under
 * `temp/character-sheets/v1/sessions/<session>/runs/<run>/`, so a stale run can
 * never address another session's or run's objects. Read paths re-validate
 * stored specs; storage failures surface as typed artifact errors. Both run and
 * session cleanup are total prefix sweeps covering unknown/future artifacts.
 */
export function createR2CharacterSheetArtifactStore(
  bucket: R2BucketLike,
): CharacterSheetArtifactStore {
  return {
    async putRunArtifacts({ sessionId, runId, spec, pdfBytes }) {
      const keys = getRunArtifactKeys(sessionId, runId);
      const payload = serializeSpec(spec);
      let specWritten = false;
      try {
        await bucket.put(keys.spec, payload, {
          httpMetadata: {
            contentType: SPEC_CONTENT_TYPE,
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
        specWritten = true;
        await bucket.put(keys.pdf, pdfBytes, {
          httpMetadata: {
            contentType: PDF_CONTENT_TYPE,
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
      } catch (error) {
        if (error instanceof CharacterSheetArtifactError) {
          throw error;
        }
        if (specWritten) {
          try {
            await deleteAllBelowPrefix(
              bucket,
              getRunArtifactPrefix(sessionId, runId),
            );
          } catch {
            throw artifactError(
              "cleanup_failed",
              "Character sheet run artifact compensation cleanup failed.",
            );
          }
        }
        throw artifactError(
          "storage_unavailable",
          "Character sheet artifact storage is unavailable.",
        );
      }
    },

    async getSpec(identity) {
      const object = await getObject(bucket, identity, "spec");
      if (object === null) {
        return null;
      }
      let payload: string;
      try {
        payload = await object.text();
      } catch (error) {
        if (error instanceof CharacterSheetArtifactError) {
          throw error;
        }
        throw artifactError(
          "storage_unavailable",
          "Character sheet artifact storage is unavailable.",
        );
      }
      return parseStoredSpec(payload);
    },

    async getPdfBytes(identity) {
      const object = await getObject(bucket, identity, "pdf");
      if (object === null) {
        return null;
      }
      try {
        return await object.bytes();
      } catch (error) {
        if (error instanceof CharacterSheetArtifactError) {
          throw error;
        }
        throw artifactError(
          "storage_unavailable",
          "Character sheet artifact storage is unavailable.",
        );
      }
    },

    async deleteRunArtifacts(identity) {
      await deleteAllBelowPrefix(
        bucket,
        getRunArtifactPrefix(identity.sessionId, identity.runId),
      );
    },

    async deleteSessionArtifacts(sessionId) {
      await deleteAllBelowPrefix(bucket, getSessionArtifactPrefix(sessionId));
    },
  };
}

async function getObject(
  bucket: R2BucketLike,
  identity: CharacterSheetArtifactIdentity,
  kind: "spec" | "pdf",
): Promise<{ text(): Promise<string>; bytes(): Promise<Uint8Array> } | null> {
  const keys = getRunArtifactKeys(identity.sessionId, identity.runId);
  try {
    return await bucket.get(kind === "spec" ? keys.spec : keys.pdf);
  } catch {
    throw artifactError(
      "storage_unavailable",
      "Character sheet artifact storage is unavailable.",
    );
  }
}
