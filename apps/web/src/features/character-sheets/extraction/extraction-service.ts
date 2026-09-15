import type { CharacterSheetDraft } from "@repo/character-sheet-draft";

/** Transport-neutral description of an uploaded sheet document. */
export interface SheetDocumentFileDescriptor {
  name: string;
  mimeType: string;
  size: number;
}

export interface ExtractSheetDocumentInput {
  sessionId: string;
  file: SheetDocumentFileDescriptor;
}

/**
 * Boundary for document → CharacterSheetDraft extraction: a user uploads a
 * PDF/PNG/JPG, extraction derives an editable draft surface, and the workshop
 * opens it through the same store as any other draft.
 *
 * The current MVP ships the placeholder implementation only. The production
 * multimodal extraction backend (vision model) is a future phase; it will
 * implement this same port so the workshop and store stay untouched.
 */
export interface SheetDocumentExtractionService {
  extractSheetDocument(
    input: ExtractSheetDocumentInput,
  ): Promise<CharacterSheetDraft>;
}