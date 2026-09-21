import type { PDFFont } from "pdf-lib";

import { CharacterSheetPdfRenderError } from "./errors";

/**
 * Deterministic text fitting for the Standard 14 fonts.
 *
 * The renderer shrinks fonts down to a documented minimum and, where layout
 * permits, wraps labels. Labels and section headings that still cannot fit
 * fail visibly with `layout_overflow` rather than truncating; field values
 * clamp to the 7pt minimum with the full value preserved in /V.
 */

export const LABEL_START_SIZE = 8;
export const LABEL_MIN_SIZE = 7;
export const LABEL_MAX_WRAP_LINES = 2;

export const TITLE_START_SIZE = 10;
export const TITLE_MIN_SIZE = 8;

export const FIELD_VALUE_START_SIZE = 10;
export const FIELD_VALUE_MIN_SIZE = 7;

export interface FittedLabel {
  readonly lines: readonly string[];
  readonly fontSize: number;
}

/**
 * Returns the largest supported font size at which the full text fits on one
 * line within maxWidth. Throws `layout_overflow` if even MIN does not fit,
 * unless `clampToMin` is set, in which case MIN is returned.
 *
 * With `clampToMin`, field values are reduced deterministically to the 7pt
 * minimum. If the full single-line value still exceeds the widget width at
 * that floor, the complete value remains stored in the field's /V entry while
 * the initial static appearance may be clipped to the widget bounds.
 */
export function fitSingleLine(
  font: PDFFont,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  context: string,
  clampToMin = false,
): number {
  for (let size = startSize; size >= minSize; size -= 1) {
    const width = font.widthOfTextAtSize(text, size);
    if (width <= maxWidth) {
      return size;
    }
  }
  if (clampToMin) {
    return minSize;
  }
  throw new CharacterSheetPdfRenderError(
    "layout_overflow",
    `${context} cannot fit on a single line between ${minSize} and ${startSize}pt.`,
  );
}

/**
 * Deterministic label fitting. Shrinks the font first; if the whole label
 * still does not fit at `LABEL_MIN_SIZE`, wraps words into up to
 * `LABEL_MAX_WRAP_LINES` lines. Throws `layout_overflow` when even that cannot
 * hold the text.
 */
export function fitLabel(
  font: PDFFont,
  text: string,
  maxWidth: number,
  context: string,
): FittedLabel {
  for (let size = LABEL_START_SIZE; size >= LABEL_MIN_SIZE; size -= 1) {
    const width = font.widthOfTextAtSize(text, size);
    if (width <= maxWidth) {
      return { lines: [text], fontSize: size };
    }
  }

  const lines = wrapWords(font, text, maxWidth, LABEL_MIN_SIZE);
  if (lines.length > LABEL_MAX_WRAP_LINES) {
    throw new CharacterSheetPdfRenderError(
      "layout_overflow",
      `${context} wraps beyond ${LABEL_MAX_WRAP_LINES} lines even at ` +
        `${LABEL_MIN_SIZE}pt.`,
    );
  }
  return { lines, fontSize: LABEL_MIN_SIZE };
}

/**
 * Greedy word wrap that never splits individual words and throws if a single
 * word is wider than maxWidth at the given size.
 */
function wrapWords(
  font: PDFFont,
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
    }
    const wordWidth = font.widthOfTextAtSize(word, fontSize);
    if (wordWidth > maxWidth) {
      throw new CharacterSheetPdfRenderError(
        "layout_overflow",
        `A single word is wider than the available space at ${fontSize}pt.`,
      );
    }
    current = word;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

export function fitSectionTitle(
  font: PDFFont,
  text: string,
  maxWidth: number,
  context: string,
): number {
  return fitSingleLine(
    font,
    text,
    maxWidth,
    TITLE_START_SIZE,
    TITLE_MIN_SIZE,
    context,
  );
}

export function fitFieldValue(
  font: PDFFont,
  text: string,
  maxWidth: number,
  context: string,
): number {
  // Multiline textarea values are wrapped by pdf-lib at draw time; the font
  // size must fit the widest line, not the whole text including newlines.
  const widestLine = text
    .split(/\r?\n/)
    .reduce(
      (widest, line) => (line.length > widest.length ? line : widest),
      "",
    );
  return fitSingleLine(
    font,
    widestLine,
    maxWidth,
    FIELD_VALUE_START_SIZE,
    FIELD_VALUE_MIN_SIZE,
    context,
    true,
  );
}
