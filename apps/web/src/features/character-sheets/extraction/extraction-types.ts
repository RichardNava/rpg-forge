/**
 * Transport-neutral description of an uploaded sheet document, used by the
 * V2 extraction boundary. The uploaded-file contract is independent of the
 * produced snapshot type.
 */
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
