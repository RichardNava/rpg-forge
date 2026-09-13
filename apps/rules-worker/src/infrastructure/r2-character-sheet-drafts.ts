import {
  DraftError,
  draftError,
  getDraftPrefix,
  getDraftSnapshotKey,
  parseDraftVersionFromObjectKey,
  validateDraft,
  type CharacterSheetDraft,
  type CharacterSheetDraftIdentity,
  type CharacterSheetDraftStore,
} from "@repo/character-sheet-draft";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";

const R2_DELETE_BATCH_MAX = 1_000;

const DRAFT_CONTENT_TYPE = "application/json; charset=utf-8";
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
    throw draftError(
      "cleanup_failed",
      "Failed to delete character sheet drafts.",
    );
  }
}

/**
 * R2-backed immutable versioned draft snapshots. Drafts live under
 * `temp/character-sheets/v1/sessions/<session>/drafts/<draftId>/`, a sibling
 * of `runs/`, so the 14.7B total session-prefix sweep also wipes session
 * drafts by construction (pinned by the `deleteSessionArtifacts` regression).
 * One put writes exactly one full snapshot under `v<version>.json`; missing
 * reads return null and corruption re-validates through the draft schema.
 */
export function createR2CharacterSheetDraftStore(
  bucket: R2BucketLike,
): CharacterSheetDraftStore {
  return {
    async putDraft(draft) {
      const validated = validateDraft(draft);
      const key = getDraftSnapshotKey(
        validated.sessionId,
        validated.draftId,
        validated.version,
      );
      try {
        await bucket.put(key, JSON.stringify(validated), {
          httpMetadata: {
            contentType: DRAFT_CONTENT_TYPE,
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
      } catch (error) {
        if (error instanceof DraftError) {
          throw error;
        }
        throw draftError(
          "storage_unavailable",
          "Character sheet draft storage is unavailable.",
        );
      }
    },

    async getDraftVersion(identity, version) {
      const object = await getDraftObject(bucket, identity, version);
      if (object === null) {
        return null;
      }
      let payload: string;
      try {
        payload = await object.text();
      } catch (error) {
        if (error instanceof DraftError) {
          throw error;
        }
        throw draftError(
          "storage_unavailable",
          "Character sheet draft storage is unavailable.",
        );
      }
      return parseStoredDraft(payload);
    },

    async listDraftVersions(identity) {
      const prefix = getDraftPrefix(identity.sessionId, identity.draftId);
      let cursor: string | undefined;
      const versions: number[] = [];
      try {
        do {
          const page = await bucket.list({
            prefix,
            limit: R2_DELETE_BATCH_MAX,
            ...(cursor === undefined ? {} : { cursor }),
          });
          for (const object of page.objects) {
            const version = parseDraftVersionFromObjectKey(object.key, prefix);
            if (version !== null && !versions.includes(version)) {
              versions.push(version);
            }
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor !== undefined);
      } catch {
        throw draftError(
          "storage_unavailable",
          "Character sheet draft storage is unavailable.",
        );
      }
      return versions.sort((a, b) => a - b);
    },

    async getLatestDraft(identity) {
      const versions = await this.listDraftVersions(identity);
      if (versions.length === 0) {
        return null;
      }
      const latestVersion = versions[versions.length - 1];
      if (latestVersion === undefined) {
        return null;
      }
      return this.getDraftVersion(identity, latestVersion);
    },

    async deleteDraft(identity) {
      await deleteAllBelowPrefix(
        bucket,
        getDraftPrefix(identity.sessionId, identity.draftId),
      );
    },
  };
}

function parseStoredDraft(payload: string): CharacterSheetDraft {
  try {
    return validateDraft(JSON.parse(payload));
  } catch (error) {
    if (error instanceof DraftError && error.code === "invalid_draft") {
      throw draftError(
        "corrupt_draft",
        "Stored draft failed schema validation.",
      );
    }
    if (error instanceof DraftError) {
      throw error;
    }
    throw draftError("corrupt_draft", "Stored draft is not valid JSON.");
  }
}

async function getDraftObject(
  bucket: R2BucketLike,
  identity: CharacterSheetDraftIdentity,
  version: number,
): Promise<{ text(): Promise<string> } | null> {
  const key = getDraftSnapshotKey(
    identity.sessionId,
    identity.draftId,
    version,
  );
  try {
    const object = await bucket.get(key);
    if (object === null) {
      return null;
    }
    return { text: () => object.text() };
  } catch (error) {
    if (error instanceof DraftError) {
      throw error;
    }
    throw draftError(
      "storage_unavailable",
      "Character sheet draft storage is unavailable.",
    );
  }
}
