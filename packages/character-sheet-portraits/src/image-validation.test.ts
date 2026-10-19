import { describe, expect, it } from "vitest";
import {
  isJpegMagic,
  isPngMagic,
  readJpegDimensions,
  readPngDimensions,
  validatePortraitImageBytes,
  PORTRAIT_MAX_BYTES,
} from "./image-validation.ts";

function bytesOf(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function tinyPng(): Uint8Array {
  // 1x1 PNG: signature + IHDR (1x1) + IDAT + IEND.
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
    0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xfb, 0x03,
    0x0c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function tinyJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22,
    0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

describe("portrait image validation", () => {
  it("accepts a valid PNG with decoded dimensions", () => {
    expect(isPngMagic(tinyPng())).toBe(true);
    expect(isJpegMagic(tinyPng())).toBe(false);
    expect(readPngDimensions(tinyPng())).toEqual({ width: 1, height: 1 });
    const result = validatePortraitImageBytes(tinyPng());
    expect(result).toMatchObject({ valid: true, code: null, mimeType: "image/png", width: 1, height: 1 });
  });

  it("accepts a valid JPEG with decoded dimensions", () => {
    expect(isJpegMagic(tinyJpeg())).toBe(true);
    expect(isPngMagic(tinyJpeg())).toBe(false);
    expect(readJpegDimensions(tinyJpeg())).toEqual({ width: 1, height: 1 });
    const result = validatePortraitImageBytes(tinyJpeg());
    expect(result).toMatchObject({ valid: true, code: null, mimeType: "image/jpeg", width: 1, height: 1 });
  });

  it("rejects empty input", () => {
    expect(validatePortraitImageBytes(new Uint8Array(0))).toMatchObject({
      valid: false,
      code: "empty",
    });
  });

  it("rejects oversized input before sniffing content", () => {
    const bytes = new Uint8Array(PORTRAIT_MAX_BYTES + 1);
    bytes[0] = 0x89;
    expect(validatePortraitImageBytes(bytes)).toMatchObject({ valid: false, code: "too_large" });
  });

  it("rejects non-image bytes by magic, not extension", () => {
    const bytes = bytesOf("%PDF-1.4 fake");
    expect(validatePortraitImageBytes(bytes)).toMatchObject({
      valid: false,
      code: "unsupported_type",
    });
  });

  it("rejects truncated PNG headers", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(validatePortraitImageBytes(bytes)).toMatchObject({
      valid: false,
      code: "invalid_content",
      mimeType: "image/png",
    });
  });

  it("rejects truncated JPEG without SOF", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(validatePortraitImageBytes(bytes)).toMatchObject({
      valid: false,
      code: "invalid_content",
      mimeType: "image/jpeg",
    });
  });

  it("rejects GIF magic as unsupported", () => {
    const bytes = bytesOf("GIF89a................");
    expect(validatePortraitImageBytes(bytes).code).toBe("unsupported_type");
  });
});
