import { MAX_RULEBOOK_BYTES } from "./model.js";

const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PDF_SIGNATURE_SCAN_BYTES = 1024;

export type RulebookUploadErrorCode =
  "RULEBOOK_INVALID_PDF" | "RULEBOOK_TOO_LARGE";

export class RulebookUploadError extends Error {
  readonly code: RulebookUploadErrorCode;

  constructor(code: RulebookUploadErrorCode) {
    super(code);
    this.code = code;
    this.name = "RulebookUploadError";
  }
}

export interface ValidatedPdfUpload {
  bytes: AsyncIterable<Uint8Array>;
  getSizeBytes(): number;
}

export function isDeclaredRulebookTooLarge(
  contentLength: number | null,
  maxBytes = MAX_RULEBOOK_BYTES,
): boolean {
  return contentLength !== null && contentLength > maxBytes;
}

/**
 * Validates the raw PDF stream while forwarding its original chunks. The
 * implementation retains only the first 1024 bytes for signature inspection.
 */
export function validatePdfUpload(
  source: AsyncIterable<Uint8Array>,
  maxBytes = MAX_RULEBOOK_BYTES,
): ValidatedPdfUpload {
  let sizeBytes = 0;
  const signaturePrefix = new Uint8Array(PDF_SIGNATURE_SCAN_BYTES);
  let signaturePrefixLength = 0;

  async function* validated(): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      const nextSize = sizeBytes + chunk.byteLength;
      if (nextSize > maxBytes) {
        throw new RulebookUploadError("RULEBOOK_TOO_LARGE");
      }
      sizeBytes = nextSize;
      copySignaturePrefix(chunk);
      yield chunk;
    }

    if (!hasPdfSignature(signaturePrefix, signaturePrefixLength)) {
      throw new RulebookUploadError("RULEBOOK_INVALID_PDF");
    }
  }

  function copySignaturePrefix(chunk: Uint8Array): void {
    const remaining = PDF_SIGNATURE_SCAN_BYTES - signaturePrefixLength;
    if (remaining <= 0) {
      return;
    }
    const copyLength = Math.min(remaining, chunk.byteLength);
    signaturePrefix.set(chunk.subarray(0, copyLength), signaturePrefixLength);
    signaturePrefixLength += copyLength;
  }

  return {
    bytes: { [Symbol.asyncIterator]: validated },
    getSizeBytes: () => sizeBytes,
  };
}

function hasPdfSignature(bytes: Uint8Array, length: number): boolean {
  const lastStart = length - PDF_SIGNATURE.length;
  for (let start = 0; start <= lastStart; start += 1) {
    let matches = true;
    for (let index = 0; index < PDF_SIGNATURE.length; index += 1) {
      if (bytes[start + index] !== PDF_SIGNATURE[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}
