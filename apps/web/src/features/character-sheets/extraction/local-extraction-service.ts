import { validateSheetUploadFile } from "../lib/sheet-upload-validation";
import type {
  SheetDocumentExtractionService,
} from "./extraction-service";

export interface LocalSheetDocumentExtractionOptions {
  /** Simulated extraction latency in milliseconds (0 disables the delay). */
  delayMs?: number;
}

const EXTRACTION_DELAY_MS = 900;

/**
 * Explicit local-development double. It must never invent a draft from a file
 * name: doing so makes a failed extraction indistinguishable from success.
 */
export function createLocalSheetDocumentExtractionService(
  options: LocalSheetDocumentExtractionOptions = {},
): SheetDocumentExtractionService {
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
