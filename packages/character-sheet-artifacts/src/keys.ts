import { artifactError } from "./errors.js";

export const CHARACTER_SHEET_ARTIFACT_KEY_VERSION = "v1" as const;

const MAX_PATH_SEGMENT_LENGTH = 128;

export interface CharacterSheetRunArtifactKeys {
  spec: string;
  pdf: string;
}

/**
 * Maps an opaque identity segment (session or run id) to a safe R2 path
 * segment. Rejects values that could traverse directories or collide with
 * R2 list semantics, then percent-encodes the remainder. Run and session ids
 * are server-minted opaque strings (UUIDs), so rejection is a guard, not a
 * user-facing validation path.
 */
export function artifactPathSegment(value: string, label: string): string {
  if (value.length === 0 || value.length > MAX_PATH_SEGMENT_LENGTH) {
    throw artifactError(
      "invalid_artifact_identity",
      `Artifact ${label} must be between 1 and ${MAX_PATH_SEGMENT_LENGTH} characters.`,
    );
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw artifactError(
      "invalid_artifact_identity",
      `Artifact ${label} contains illegal characters.`,
    );
  }
  return encodeURIComponent(value);
}

export function getSessionArtifactPrefix(sessionId: string): string {
  return `temp/character-sheets/${CHARACTER_SHEET_ARTIFACT_KEY_VERSION}/sessions/${artifactPathSegment(sessionId, "sessionId")}/`;
}

export function getRunArtifactPrefix(sessionId: string, runId: string): string {
  return `${getSessionArtifactPrefix(sessionId)}runs/${artifactPathSegment(runId, "runId")}/`;
}

export function getRunArtifactKeys(
  sessionId: string,
  runId: string,
): CharacterSheetRunArtifactKeys {
  const prefix = getRunArtifactPrefix(sessionId, runId);
  return {
    spec: `${prefix}spec.json`,
    pdf: `${prefix}sheet.pdf`,
  };
}
