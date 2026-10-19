import { portraitAssetError } from "./portrait-asset.ts";

export const PORTRAIT_ARTIFACT_KEY_VERSION = "v1" as const;

const MAX_PATH_SEGMENT_LENGTH = 128;

export interface PortraitAssetKeys {
  image: string;
  metadata: string;
}

/**
 * Maps an opaque identity segment (session or asset id) to a safe R2 path
 * segment. Rejects values that could traverse directories or collide with R2
 * list semantics, then percent-encodes the remainder. Asset ids are
 * server-minted opaque strings (UUIDs), so rejection is a guard, not a
 * user-facing validation path.
 */
export function portraitPathSegment(value: string, label: string): string {
  if (value.length === 0 || value.length > MAX_PATH_SEGMENT_LENGTH) {
    throw portraitAssetError(
      "invalid_asset_identity",
      `Portrait ${label} must be between 1 and ${MAX_PATH_SEGMENT_LENGTH} characters.`,
    );
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw portraitAssetError(
      "invalid_asset_identity",
      `Portrait ${label} contains illegal characters.`,
    );
  }
  return encodeURIComponent(value);
}

export function getSessionPortraitPrefix(sessionId: string): string {
  return `temp/character-sheets/v1/sessions/${portraitPathSegment(sessionId, "sessionId")}/portraits/`;
}

export function getPortraitAssetPrefix(sessionId: string, assetId: string): string {
  return `${getSessionPortraitPrefix(sessionId)}${portraitPathSegment(assetId, "assetId")}/`;
}

export function getPortraitAssetKeys(sessionId: string, assetId: string): PortraitAssetKeys {
  const prefix = getPortraitAssetPrefix(sessionId, assetId);
  return {
    image: `${prefix}image`,
    metadata: `${prefix}metadata.json`,
  };
}
