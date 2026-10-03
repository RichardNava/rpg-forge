import { validateSheetUploadFile } from "../lib/sheet-upload-validation";
import type { SheetDocumentExtractionServiceV2 } from "./extraction-service-v2";

export interface LocalSheetDocumentExtractionV2Options {
  /** Simulated extraction latency in milliseconds (0 disables the delay). */
  delayMs?: number;
}

const EXTRACTION_DELAY_MS = 900;

/**
 * Explicit local-development double for the V2 extraction boundary. It must
 * never invent a draft from a file name.
 */
export function createLocalSheetDocumentExtractionServiceV2(
  options: LocalSheetDocumentExtractionV2Options = {},
): SheetDocumentExtractionServiceV2 {
  const delayMs = options.delayMs ?? EXTRACTION_DELAY_MS;

  return {
    async extractSheetDocument({ file }) {
      const validation = validateSheetUploadFile({
        name: file.name,
        type: file.mimeType,
        size: file.size,
      });
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      throw new Error(
        "Document extraction requires the remote AI service in this environment.",
      );
    },
  };
}
