import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import type {
  ExtractSheetDocumentInput,
  SheetDocumentFileDescriptor,
} from "./extraction-service";

export type { ExtractSheetDocumentInput, SheetDocumentFileDescriptor };

/**
 * Parallel V2 boundary for document → canonical V2 draft extraction. The input
 * contract (uploaded file descriptor) is intentionally identical to V1; only
 * the produced snapshot differs. The remote implementation is the product
 * path; the local double rejects uploads rather than fabricating a draft.
 */
export interface SheetDocumentExtractionServiceV2 {
  extractSheetDocument(
    input: ExtractSheetDocumentInput,
  ): Promise<CharacterSheetDraftV2>;
}
