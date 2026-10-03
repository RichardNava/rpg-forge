import {
  DraftError,
  draftError,
  getDraftPrefix,
  getDraftSnapshotKey,
  parseCanonicalCharacterSheetDraft,
  parseDraftVersionFromObjectKey,
  validateDraftV2,
  type CharacterSheetDraftIdentity,
  type CharacterSheetDraftStoreV2,
} from "@repo/character-sheet-draft";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";

const R2_DELETE_BATCH_MAX = 1_000;

const DRAFT_CONTENT_TYPE = "application/json; charset=utf-8";
const CACHE_CONTROL_NO_STORE = "no-store";

/**
 * R2 adapter for the canonical V2 draft port — the sole live draft store.
 *
 * ## Key layout is unchanged
 *
 * Snapshots still live under
 * `temp/character-sheets/v1/sessions/<session>/drafts/<draftId>/vN.json`.
 * The `/v1/` segment is the R2 key-LAYOUT version, which is independent of
 * `CharacterSheetDraft.schemaVersion`. The `vN` segment is the draft VERSION,
 * not the draft schema version. Renaming the prefix to `/v2/` would orphan every
 * historical V1 object and break the 14.7B session sweep, so there is no
 * key migration here and never will be one triggered by V2 drafts.
 *
 * ## Migration ownership
 *
 * `parseCanonicalCharacterSheetDraft` is the ONLY V1/V2 compatibility boundary.
 * This adapter does not branch on `schemaVersion` and does not re-implement the
 * V1-to-V2 migration; it parses JSON, hands the result to the canonical parser,
 * and receives a `CharacterSheetDraftV2`.
 *
 * Read migration happens IN MEMORY ONLY. A stored V1 snapshot is never rewritten
 * merely because it was read, so a read performs zero `bucket.put` calls.
 */
export function createR2CharacterSheetDraftStoreV2(
  bucket: R2BucketLike,
): CharacterSheetDraftStoreV2 {
  return {
    async putInitialDraftIfAbsent(draft) {
      // The gate runs BEFORE any bucket call, so an invalid or V1 snapshot can
      // never reach storage.
      const validated = validateDraftV2(draft);
      const key = getDraftSnapshotKey(
        validated.sessionId,
        validated.draftId,
        validated.version,
      );
      try {
        const result = await bucket.put(key, JSON.stringify(validated), {
          onlyIf: new Headers({ "If-None-Match": "*" }),
          httpMetadata: {
            contentType: DRAFT_CONTENT_TYPE,
            cacheControl: CACHE_CONTROL_NO_STORE,
          },
        });
        if (result === null) {
          return { kind: "already_exists" };
        }
        return { kind: "created" };
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

    async putDraft(draft) {
      // The gate runs BEFORE any bucket call, so an invalid or V1 snapshot can
      // never reach storage.
      const validated = validateDraftV2(draft);
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
        // A missing immutable snapshot is not corruption and not a migration
        // event.
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
      const canonical = parseStoredDraft(payload);
      assertStoredIdentity(canonical, identity, version);
      return canonical;
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
      // The latest version is chosen NUMERICALLY from the listed versions, never
      // by lexicographic object key, so v10 correctly beats v9.
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

/**
 * Verifies that the canonical payload actually belongs to the requested
 * identity and immutable version.
 *
 * The object key and the payload body are independent storage facts, so they can
 * disagree. That disagreement is STORED CORRUPTION, never a client concurrency
 * outcome: reporting it as `version_conflict` would invite a retry loop against
 * data that can never succeed, and reporting it as `not found` would hide a
 * genuine integrity failure.
 */
function assertStoredIdentity(
  draft: { sessionId: string; draftId: string; version: number },
  identity: CharacterSheetDraftIdentity,
  requestedVersion: number,
): void {
  if (draft.sessionId !== identity.sessionId) {
    throw draftError(
      "corrupt_draft",
      "Stored draft session id does not match the requested session.",
    );
  }
  if (draft.draftId !== identity.draftId) {
    throw draftError(
      "corrupt_draft",
      "Stored draft id does not match the requested draft.",
    );
  }
  if (draft.version !== requestedVersion) {
    throw draftError(
      "corrupt_draft",
      `Stored draft version ${draft.version} does not match the requested version ${requestedVersion}.`,
    );
  }
}

/**
 * Turns stored bytes into a canonical V2 draft.
 *
 * Every failure mode — invalid JSON, invalid V1, invalid V2 — collapses to
 * `corrupt_draft`, so no `SyntaxError`, `ZodError` or `invalid_draft` leaks out
 * of a stored-content read.
 */
function parseStoredDraft(
  payload: string,
): ReturnType<typeof parseCanonicalCharacterSheetDraft> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw draftError("corrupt_draft", "Stored draft is not valid JSON.");
  }
  try {
    return parseCanonicalCharacterSheetDraft(parsed);
  } catch {
    throw draftError(
      "corrupt_draft",
      "Stored draft failed canonical schema validation.",
    );
  }
}

async function getDraftObject(
  bucket: R2BucketLike,
  identity: CharacterSheetDraftIdentity,
  version: number,
): Promise<Awaited<ReturnType<R2BucketLike["get"]>>> {
  const key = getDraftSnapshotKey(
    identity.sessionId,
    identity.draftId,
    version,
  );
  let object: Awaited<ReturnType<R2BucketLike["get"]>>;
  try {
    object = await bucket.get(key);
  } catch (error) {
    if (error instanceof DraftError) {
      throw error;
    }
    throw draftError(
      "storage_unavailable",
      "Character sheet draft storage is unavailable.",
    );
  }
  if (object === null) {
    return null;
  }
  return object;
}

/**
 * Deletes every object under an exact prefix (trailing slash included), page by
 * page, until none remain. The trailing slash is what keeps a similarly prefixed
 * sibling draft id out of the sweep. Idempotent: an empty prefix deletes
 * nothing. Any list/delete failure surfaces as `cleanup_failed`.
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
