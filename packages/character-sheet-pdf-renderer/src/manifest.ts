/**
 * PdfRenderManifest describes the deterministic output of the PDF renderer so
 * downstream consumers can verify field registration without parsing PDF bytes.
 */

export interface PdfRenderFormFieldEntry {
  /** The canonical character-sheet field id (e.g. "character_name"). */
  readonly canonicalKey: string;
  /** The AcroForm field name (e.g. "rpgforge.character_name"). */
  readonly pdfFieldName: string;
  /** Zero-based PDF page index. */
  readonly pageIndex: number;
  /** Whether the widget is editable by the end user. */
  readonly editable: boolean;
}

export interface PdfRenderManifest {
  readonly schemaVersion: "1";
  /** Number of pages in the rendered PDF. */
  readonly pageCount: number;
  /**
   * All form fields in deterministic render order (page → section → field).
   * Ordered identically across renders of the same spec.
   */
  readonly formFields: readonly PdfRenderFormFieldEntry[];
}

export function buildManifest(
  pageCount: number,
  formFields: readonly PdfRenderFormFieldEntry[],
): PdfRenderManifest {
  return { schemaVersion: "1", pageCount, formFields };
}
