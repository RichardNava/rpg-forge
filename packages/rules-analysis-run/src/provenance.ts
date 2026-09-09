import {
  UploadedRulebookSourceSchema,
  type UploadedRulebookSource,
} from "@repo/rules-context";

export function rulebookSourceId(ingestionId: string): string {
  return `rulebook-${ingestionId}`;
}

/**
 * The upload transport carries raw PDF bytes without a filename, so the worker
 * derives a stable, safe display name from the generation identifier.
 */
export function rulebookDisplayFilename(ingestionId: string): string {
  return `rulebook-${ingestionId}.pdf`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexFromDigest(digest);
}

function hexFromDigest(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function buildUploadedRulebookSource(input: {
  ingestionId: string;
  fileSize: number;
  pageCount: number | null;
  sha256: string;
}): UploadedRulebookSource {
  return UploadedRulebookSourceSchema.parse({
    id: rulebookSourceId(input.ingestionId),
    type: "uploaded-rulebook",
    filename: rulebookDisplayFilename(input.ingestionId),
    fileSize: input.fileSize,
    pageCount: input.pageCount,
    sha256: input.sha256,
    temporary: true,
  });
}
