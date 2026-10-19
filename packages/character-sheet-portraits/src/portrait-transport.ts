import { z } from "zod";
import { PortraitAssetIdSchema, PortraitAssetSourceSchema } from "./portrait-asset.ts";

/**
 * Shared portrait transport contracts (14.13). Route identity carries
 * sessionId (and assetId for reads); bodies carry only bounded options.
 * Draft authority never travels here.
 */
export const PortraitAssetRefSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  assetId: PortraitAssetIdSchema,
  source: PortraitAssetSourceSchema,
  mimeType: z.enum(["image/png", "image/jpeg"]),
});
export type PortraitAssetRef = z.infer<typeof PortraitAssetRefSchema>;

export const PortraitImportUrlRequestSchema = z.strictObject({
  url: z.string().min(1).max(2048),
});
export type PortraitImportUrlRequest = z.infer<typeof PortraitImportUrlRequestSchema>;

export const PortraitGenerateRequestSchema = z.strictObject({
  prompt: z.string().min(1).max(2000),
});
export type PortraitGenerateRequest = z.infer<typeof PortraitGenerateRequestSchema>;
