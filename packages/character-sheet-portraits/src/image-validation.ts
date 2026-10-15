/**
 * Server-side portrait image validation (14.13).
 *
 * Accepts only PNG and JPEG, verified by file signature (magic bytes) — never
 * by Content-Type alone. Decoded pixel dimensions are bounded so a hostile
 * image cannot force unbounded allocation downstream. Reuses the same safety
 * posture as uploaded sheet extraction (magic-first, bounded bytes/pixels)
 * without duplicating its document-specific limits.
 */

export const PORTRAIT_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type PortraitMimeType = (typeof PORTRAIT_ACCEPTED_MIME_TYPES)[number];

/** Maximum portrait upload/import payload: 8 MiB (mirrors sheet documents). */
export const PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum decoded portrait pixels: 40M (mirrors sheet document images). */
export const PORTRAIT_MAX_IMAGE_PIXELS = 40_000_000;

export type PortraitImageValidationCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "invalid_content"
  | "too_many_pixels";

export interface PortraitImageValidation {
  readonly valid: boolean;
  readonly code: PortraitImageValidationCode | null;
  readonly mimeType: PortraitMimeType | null;
  readonly width: number | null;
  readonly height: number | null;
}

export function isPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export function isJpegMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Reads PNG IHDR dimensions (width/height as big-endian uint32 at offsets
 * 16/20). Returns null when the header is truncated or malformed.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPngMagic(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * Scans JPEG segments for the first Start-Of-Frame marker and reads its
 * dimensions. Returns null when no SOF segment is found.
 */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpegMagic(bytes)) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 7 || offset + length > bytes.length) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    offset += length;
  }
  return null;
}

/**
 * Validates raw portrait image bytes: non-empty, bounded, PNG/JPEG magic,
 * decodable dimensions, bounded pixel count.
 */
export function validatePortraitImageBytes(bytes: Uint8Array): PortraitImageValidation {
  if (bytes.length === 0) {
    return { valid: false, code: "empty", mimeType: null, width: null, height: null };
  }
  if (bytes.length > PORTRAIT_MAX_BYTES) {
    return { valid: false, code: "too_large", mimeType: null, width: null, height: null };
  }
  const png = isPngMagic(bytes);
  const jpeg = !png && isJpegMagic(bytes);
  if (!png && !jpeg) {
    return { valid: false, code: "unsupported_type", mimeType: null, width: null, height: null };
  }
  const mimeType: PortraitMimeType = png ? "image/png" : "image/jpeg";
  const dimensions = png ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  if (dimensions === null) {
    return { valid: false, code: "invalid_content", mimeType, width: null, height: null };
  }
  if (dimensions.width * dimensions.height > PORTRAIT_MAX_IMAGE_PIXELS) {
    return {
      valid: false,
      code: "too_many_pixels",
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
    };
  }
  return {
    valid: true,
    code: null,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
  };
}
