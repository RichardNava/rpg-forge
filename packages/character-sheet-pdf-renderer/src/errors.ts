/**
 * Renderer-specific error taxonomy. Small by design: one error class with a
 * finite code set. Parser errors from CharacterSheetSpecSchema are surfaced as
 * `invalid_spec`; renderer-internal failures map to the remaining codes.
 */

export const PDF_RENDER_ERROR_CODES = [
  "invalid_spec",
  "unsupported_field_type",
  "unsupported_field_value",
  "unsupported_glyph",
  "layout_overflow",
  "duplicate_form_field",
  "pdf_generation_failed",
] as const;

export type CharacterSheetPdfRenderErrorCode =
  (typeof PDF_RENDER_ERROR_CODES)[number];

export class CharacterSheetPdfRenderError extends Error {
  readonly code: CharacterSheetPdfRenderErrorCode;

  constructor(code: CharacterSheetPdfRenderErrorCode, message: string) {
    super(message);
    this.name = "CharacterSheetPdfRenderError";
    this.code = code;
  }
}
