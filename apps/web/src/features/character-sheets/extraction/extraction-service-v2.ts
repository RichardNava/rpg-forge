import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import type {
  ExtractSheetDocumentInput,
  SheetDocumentFileDescriptor,
} from "./extraction-types";

export type { ExtractSheetDocumentInput, SheetDocumentFileDescriptor };

/**
 * V2 boundary for document → canonical V2 draft extraction. The input
 * contract carries only the uploaded file descriptor; the produced snapshot
 * is always a canonical V2 draft. The remote implementation is the product
 * path; the local double rejects uploads rather than fabricating a draft.
 */
export interface SheetDocumentExtractionServiceV2 {
  extractSheetDocument(
    input: ExtractSheetDocumentInput,
  ): Promise<CharacterSheetDraftV2>;
}
