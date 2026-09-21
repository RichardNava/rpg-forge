import {
  type CharacterSheetSpec,
  type CharacterSheetSection,
  type FieldPlacement,
  type SectionLayout,
} from "@repo/character-sheet-schema";

import { CharacterSheetPdfRenderError } from "./errors";

/**
 * Deterministic page geometry and grid packing.
 *
 * The spec carries layout *intent* (page orientation/sizeIntent, section
 * columns, per-field columnStart/columnSpan/rowSpan/breakBefore), not absolute
 * pixel geometry. This module maps that intent to deterministic PDF
 * coordinates:
 *
 * - page size comes from orientation + sizeIntent (letter/a4, compact falls
 *   back to letter) and orientation swaps width/height for landscape;
 * - fields are packed into a shared row grid that honors columnStart/columnSpan,
 *   rowSpan and breakBefore exactly as the spec describes;
 * - position derives only from the spec, so re-rendering the same spec is
 *   byte-for-byte deterministic.
 */

// Standard US Letter in PDF points.
export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;
// ISO A4 in PDF points (portrait), truncated to two decimals like pdf-lib.
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

// Margins and bands in PDF points.
export const PAGE_MARGIN = 42;
export const HEADER_HEIGHT = 44;
export const SECTION_TITLE_HEIGHT = 20;
export const SECTION_GAP = 10;
export const ROW_HEIGHT = 32;
export const LABEL_BAND_HEIGHT = 14;
export const WIDGET_PADDING = 2;
export const FOOTER_HEIGHT = 24;

export interface PageGeometry {
  readonly width: number;
  readonly height: number;
}

export function pageGeometry(
  orientation: "portrait" | "landscape",
  sizeIntent: "letter" | "a4" | "compact" | null,
): PageGeometry {
  const portrait =
    sizeIntent === "a4"
      ? { width: A4_WIDTH, height: A4_HEIGHT }
      : { width: LETTER_WIDTH, height: LETTER_HEIGHT };
  return orientation === "landscape"
    ? { width: portrait.height, height: portrait.width }
    : portrait;
}

export function contentArea(geometry: PageGeometry): number {
  return geometry.width - PAGE_MARGIN * 2;
}

export interface PlacedField {
  readonly field: import("@repo/character-sheet-schema").CharacterSheetField;
  readonly placement: FieldPlacement;
  /** Row index, 0-based. */
  readonly row: number;
  /** Widget geometry in PDF points, top-down origin. */
  readonly widgetX: number;
  readonly widgetYTop: number;
  readonly widgetWidth: number;
  readonly widgetHeight: number;
  /** Space reserved above the widget for its label band. */
  readonly labelBandTop: number;
  readonly labelBandHeight: number;
}

export interface SectionRenderResult {
  readonly fields: readonly PlacedField[];
  /** Total grid rows used by the section (0 when empty). */
  readonly rowCount: number;
}

interface FieldWithOrder {
  readonly field: import("@repo/character-sheet-schema").CharacterSheetField;
  readonly placement: FieldPlacement;
}

function fieldsInOrder(
  section: CharacterSheetSection,
  spec: CharacterSheetSpec,
): FieldWithOrder[] {
  const byId = new Map(spec.fields.map((field) => [field.id, field]));
  const fields: FieldWithOrder[] = [];
  for (const fieldId of section.fieldIds) {
    const field = byId.get(fieldId);
    if (!field) {
      throw new CharacterSheetPdfRenderError(
        "invalid_spec",
        `Section "${section.id}" references unknown field "${fieldId}".`,
      );
    }
    fields.push({ field, placement: field.placement });
  }
  fields.sort((a, b) => a.placement.order - b.placement.order);
  return fields;
}

/**
 * Deterministic grid packer.
 *
 * Fields are placed in placement order. breakBefore forces a fresh row; each
 * field occupies columnStart..columnStart+columnSpan-1 for rowSpan rows.
 * Sequential fields fill left to right within the shared row grid.
 */
export function packGrid(
  section: CharacterSheetSection,
  spec: CharacterSheetSpec,
  columns: number,
): readonly {
  field: import("@repo/character-sheet-schema").CharacterSheetField;
  placement: FieldPlacement;
  row: number;
}[] {
  const fields = fieldsInOrder(section, spec);
  const occupied: boolean[][] = [];
  const result: {
    field: import("@repo/character-sheet-schema").CharacterSheetField;
    placement: FieldPlacement;
    row: number;
  }[] = [];

  let nextRow = 0;
  for (const { field, placement } of fields) {
    const colStart = Math.min(Math.max(placement.columnStart, 1), columns);
    const colSpan = Math.min(
      Math.max(placement.columnSpan, 1),
      columns - colStart + 1,
    );
    const rowSpan = Math.max(placement.rowSpan, 1);

    let row = placement.breakBefore ? occupied.length : nextRow;

    const fits = (candidateRow: number): boolean => {
      for (let r = candidateRow; r < candidateRow + rowSpan; r += 1) {
        for (let c = colStart - 1; c < colStart - 1 + colSpan; c += 1) {
          if (occupied[r]?.[c] === true) {
            return false;
          }
        }
      }
      return true;
    };

    while (!fits(row)) {
      row += 1;
    }

    for (let r = row; r < row + rowSpan; r += 1) {
      occupied[r] ??= [];
      for (let c = colStart - 1; c < colStart - 1 + colSpan; c += 1) {
        occupied[r]![c] = true;
      }
    }
    result.push({ field, placement, row });
    nextRow = row;
  }

  return result;
}

/**
 * Derives absolute top-down geometry for every placed field plus the number
 * of grid rows the section consumes.
 */
export function layoutSection(
  section: CharacterSheetSection,
  layout: SectionLayout,
  spec: CharacterSheetSpec,
  geometry: PageGeometry,
): SectionRenderResult {
  const columns = Math.max(1, Math.min(layout.columns, 4));
  const packed = packGrid(section, spec, columns);
  const gridWidth = contentArea(geometry);
  const columnWidth = gridWidth / columns;

  const cells: PlacedField[] = [];
  let rowCount = 0;
  for (const item of packed) {
    const colStart = Math.min(Math.max(item.placement.columnStart, 1), columns);
    const colSpan = Math.min(
      Math.max(item.placement.columnSpan, 1),
      columns - colStart + 1,
    );
    const rowSpan = Math.max(item.placement.rowSpan, 1);
    const widgetX = PAGE_MARGIN + (colStart - 1) * columnWidth + WIDGET_PADDING;
    const widgetWidth = colSpan * columnWidth - WIDGET_PADDING * 2;
    const widgetHeight = rowSpan * ROW_HEIGHT - LABEL_BAND_HEIGHT;
    const widgetYTop =
      SECTION_TITLE_HEIGHT + item.row * ROW_HEIGHT + LABEL_BAND_HEIGHT;
    cells.push({
      field: item.field,
      placement: item.placement,
      row: item.row,
      widgetX,
      widgetYTop,
      widgetWidth,
      widgetHeight,
      labelBandTop: SECTION_TITLE_HEIGHT + item.row * ROW_HEIGHT,
      labelBandHeight: LABEL_BAND_HEIGHT,
    });
    rowCount = Math.max(rowCount, item.row + rowSpan);
  }

  return { fields: cells, rowCount };
}
