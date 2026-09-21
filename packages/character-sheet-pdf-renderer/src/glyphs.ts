import { CharacterSheetPdfRenderError } from "./errors";

/**
 * WinAnsi glyph gate for the Standard 14 fonts.
 *
 * The renderer only uses the built-in Standard 14 PDF fonts (Helvetica and
 * Helvetica-Bold), which are encoded with WinAnsiEncoding. Characters outside
 * that set cannot be rendered faithfully and fail visibly with
 * `unsupported_glyph` instead of being silently substituted, mangled, or
 * dropped.
 */

const WIN_ANSI_EXTRA = new Set<number>([
  0x20ac, // €
  0x201a, // ‚
  0x0192, // ƒ
  0x201e, // „
  0x2026, // …
  0x2020, // †
  0x2021, // ‡
  0x02c6, // ˆ
  0x2030, // ‰
  0x0160, // Š
  0x2039, // ‹
  0x0152, // Œ
  0x017d, // Ž
  0x2018, // '
  0x2019, // '
  0x201c, // “
  0x201d, // ”
  0x2022, // •
  0x2013, // –
  0x2014, // —
  0x02dc, // ˜
  0x2122, // ™
  0x0161, // š
  0x203a, // ›
  0x0153, // œ
  0x017e, // ž
  0x0178, // Ÿ
]);

export interface GlyphValidationOptions {
  /** Allow newline characters (multiline textarea values). Defaults to false. */
  readonly allowNewlines?: boolean;
}

export function assertSupportedGlyphs(
  text: string,
  context: string,
  options: GlyphValidationOptions = {},
): void {
  const allowNewlines = options.allowNewlines === true;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    const supported =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(code) ||
      (allowNewlines && (char === "\n" || char === "\r"));
    if (!supported) {
      throw new CharacterSheetPdfRenderError(
        "unsupported_glyph",
        `${context} contains a character the built-in WinAnsi font cannot ` +
          `encode (U+${code.toString(16).toUpperCase().padStart(4, "0")}).`,
      );
    }
  }
}
