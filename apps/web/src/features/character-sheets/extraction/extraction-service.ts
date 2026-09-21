import type { CharacterSheetDraft } from "@repo/character-sheet-draft";

/** Transport-neutral description of an uploaded sheet document. */
export interface SheetDocumentFileDescriptor {
  name: string;
  mimeType: string;
  size: number;
  /** Present for browser uploads; omitted by descriptor-only test doubles. */
  blob?: Blob;
  /** First page of a long PDF character sheet, selected by the user. */
  sheetStartPage?: number;
}

export interface ExtractSheetDocumentInput {
  sessionId: string;
  accessToken?: string;
  file: SheetDocumentFileDescriptor;
}

/**
 * Boundary for document → CharacterSheetDraft extraction: a user uploads a
 * PDF/PNG/JPG, extraction derives an editable draft surface, and the workshop
 * opens it through the same store as any other draft.
 *
 * The remote implementation is the product path. The local implementation is
 * an explicit development double that rejects uploads rather than fabricating
 * a draft from a file name.
 */
export interface SheetDocumentExtractionService {
  extractSheetDocument(
    input: ExtractSheetDocumentInput,
  ): Promise<CharacterSheetDraft>;
}
