import { draftError } from "./errors";

export const CHARACTER_SHEET_DRAFT_KEY_TENANT =
  "temp/character-sheets" as const;
export const CHARACTER_SHEET_DRAFT_KEY_VERSION = "v1" as const;

const MAX_PATH_SEGMENT_LENGTH = 128;

/**
 * Maps an opaque identity segment (session or draft id) to a safe R2 path
 * segment with the same guards as the artifact keys policy: non-empty, at most
 * 128 characters, no `/`, `\`, or `..`, then percent-encoded. Draft ids are
 * server-minted opaque strings, so rejection is a guard, not a user path.
 */
export function draftPathSegment(value: string, label: string): string {
  if (value.length === 0 || value.length > MAX_PATH_SEGMENT_LENGTH) {
    throw draftError(
      "invalid_draft_identity",
      `Draft ${label} must be between 1 and ${MAX_PATH_SEGMENT_LENGTH} characters.`,
    );
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw draftError(
      "invalid_draft_identity",
      `Draft ${label} contains illegal characters.`,
    );
  }
  return encodeURIComponent(value);
}

/**
 * Same session tenant as run artifacts: drafts live under
 * `temp/character-sheets/v1/sessions/<sessionId>/drafts/`, a sibling of
 * `runs/`. The 14.7B total session-prefix sweep therefore wipes session drafts
 * by construction; a regression suite pins that behavior.
 */
export function getSessionDraftsPrefix(sessionId: string): string {
  return `${CHARACTER_SHEET_DRAFT_KEY_TENANT}/${CHARACTER_SHEET_DRAFT_KEY_VERSION}/sessions/${draftPathSegment(sessionId, "sessionId")}/drafts/`;
}

export function getDraftPrefix(sessionId: string, draftId: string): string {
  return `${getSessionDraftsPrefix(sessionId)}${draftPathSegment(draftId, "draftId")}/`;
}

export function getDraftSnapshotKey(
  sessionId: string,
  draftId: string,
  version: number,
): string {
  if (!Number.isInteger(version) || version < 1) {
    throw draftError(
      "invalid_draft_identity",
      "A draft version must be a positive integer.",
    );
  }
  return `${getDraftPrefix(sessionId, draftId)}v${version}.json`;
}

/**
 * Parses a versioned object key back into its version number. Returns null for
 * keys that do not match the snapshot naming under the given draft prefix, so
 * unknown/future object kinds under a draft prefix are never misread.
 */
export function parseDraftVersionFromObjectKey(
  key: string,
  draftPrefix: string,
): number | null {
  if (!key.startsWith(draftPrefix)) {
    return null;
  }
  const suffix = key.slice(draftPrefix.length);
  const match = /^v(\d+)\.json$/.exec(suffix);
  return match === null ? null : Number(match[1]);
}
