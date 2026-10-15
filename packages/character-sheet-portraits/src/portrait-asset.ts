import { z } from "zod";
import type { PortraitMimeType } from "./image-validation.js";

export const PORTRAIT_ASSET_SOURCES = ["upload", "url", "ai"] as const;
export type PortraitAssetSource = (typeof PORTRAIT_ASSET_SOURCES)[number];

export const PortraitAssetSourceSchema = z.enum(PORTRAIT_ASSET_SOURCES);
export const PortraitAssetIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => !value.includes("/") && !value.includes("\\") && !value.includes(".."),
    "Portrait asset ids must be single path-safe segments.",
  );
export type PortraitAssetId = z.infer<typeof PortraitAssetIdSchema>;

/**
 * Validated portrait asset metadata. Stored alongside the image bytes;
 * re-validated on every read. Never carries raw bytes, URLs, or prompts.
 */
export const PortraitAssetMetadataSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  assetId: PortraitAssetIdSchema,
  sessionId: z.string().min(1).max(128),
  source: PortraitAssetSourceSchema,
  mimeType: z.enum(["image/png", "image/jpeg"]),
  sizeBytes: z.number().int().min(1),
  width: z.number().int().min(1).nullable(),
  height: z.number().int().min(1).nullable(),
});
export type PortraitAssetMetadata = z.infer<typeof PortraitAssetMetadataSchema>;

export function serializePortraitMetadata(metadata: PortraitAssetMetadata): string {
  return JSON.stringify(PortraitAssetMetadataSchema.parse(metadata));
}

export function parseStoredPortraitMetadata(payload: string): PortraitAssetMetadata | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = PortraitAssetMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface PortraitAssetIdentity {
  sessionId: string;
  assetId: string;
}

export interface PutPortraitAssetInput extends PortraitAssetIdentity {
  source: PortraitAssetSource;
  mimeType: PortraitMimeType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  imageBytes: Uint8Array;
}

export interface PortraitAssetRecord {
  metadata: PortraitAssetMetadata;
  imageBytes: Uint8Array;
}

export const PORTRAIT_ASSET_ERROR_CODES = [
  "invalid_asset_identity",
  "invalid_asset_source",
  "storage_unavailable",
  "corrupt_metadata",
  "cleanup_failed",
] as const;

export type PortraitAssetErrorCode = (typeof PORTRAIT_ASSET_ERROR_CODES)[number];

export class PortraitAssetError extends Error {
  readonly code: PortraitAssetErrorCode;
  constructor(code: PortraitAssetErrorCode, message: string) {
    super(message);
    this.name = "PortraitAssetError";
    this.code = code;
  }
}

export function portraitAssetError(
  code: PortraitAssetErrorCode,
  message: string,
): PortraitAssetError {
  return new PortraitAssetError(code, message);
}

/**
 * Port for temporary session-scoped portrait image assets. Keys are derived
 * from opaque identities and never become a user-facing arbitrary-key API.
 * Missing reads return null; corruption and storage failures throw typed
 * errors. No portrait bytes ever reach D1.
 */
export interface CharacterSheetPortraitAssetStore {
  putAsset(input: PutPortraitAssetInput): Promise<PortraitAssetMetadata>;
  getAsset(identity: PortraitAssetIdentity): Promise<PortraitAssetRecord | null>;
  deleteAsset(identity: PortraitAssetIdentity): Promise<void>;
  deleteSessionAssets(sessionId: string): Promise<void>;
}
