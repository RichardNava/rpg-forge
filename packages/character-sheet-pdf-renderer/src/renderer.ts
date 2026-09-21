import {
  CharacterSheetSpecSchema,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFForm,
  type PDFPage,
} from "pdf-lib";

import { CharacterSheetPdfRenderError } from "./errors";
import { assertSupportedGlyphs } from "./glyphs";
import {
  contentArea,
  layoutSection,
  pageGeometry,
  PAGE_MARGIN,
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  SECTION_GAP,
  SECTION_TITLE_HEIGHT,
} from "./layout";
import {
  buildManifest,
  type PdfRenderFormFieldEntry,
  type PdfRenderManifest,
} from "./manifest";
import type { PlacedField } from "./layout";
import { fitFieldValue, fitLabel, fitSectionTitle } from "./text";
import { pdfFieldNameFor, resolveFieldValue } from "./values";

export interface RenderCharacterSheetPdfInput {
  readonly spec: CharacterSheetSpec;
}

export interface RenderCharacterSheetPdfOutput {
  readonly bytes: Uint8Array;
  readonly manifest: PdfRenderManifest;
}

/**
 * Fixed, deterministic document metadata. All values are constants so the
 * rendered PDF never depends on wall-clock time, RNG, or the environment.
 */
export const RENDER_METADATA_EPOCH = new Date("2026-08-17T00:00:00.000Z");
export const RENDER_PRODUCER = "RPG Forge";
export const RENDER_CREATOR = "RPG Forge Character Sheet Renderer";

// Deterministic palette. Values are chosen in code and never derived from the
// ambient environment, locale, or system fonts.
const INK = rgb(0.13, 0.15, 0.18);
const HEADER_TEXT = rgb(0.24, 0.3, 0.36);
const FIELD_TEXT = rgb(0.05, 0.05, 0.05);
const FIELD_BORDER = rgb(0.45, 0.45, 0.45);
const FIELD_FILL = rgb(1, 1, 1);
const READONLY_FILL = rgb(0.96, 0.96, 0.96);
const RULE = rgb(0.2, 0.28, 0.35);

const DEFAULT_FIELD_FONT_SIZE = 10;

/** Parses a #RRGGBB theme accent into a pdf-lib RGB color. */
function accentColor(hex: string): ReturnType<typeof rgb> {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return rgb(r, g, b);
}

export async function renderCharacterSheetPdf(
  input: RenderCharacterSheetPdfInput,
): Promise<RenderCharacterSheetPdfOutput> {
  const parsed = CharacterSheetSpecSchema.safeParse(input.spec);
  if (!parsed.success) {
    throw new CharacterSheetPdfRenderError(
      "invalid_spec",
      "The provided CharacterSheetSpec failed validation: " +
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
    );
  }
  const spec = parsed.data;

  // Validate every drawn string before any PDF work so glyph failures surface
  // with a deterministic code rather than a mid-render error.
  assertSupportedGlyphs(spec.metadata.title, "sheet title");
  for (const section of spec.sections) {
    assertSupportedGlyphs(section.title, `section title "${section.title}"`);
    for (const fieldId of section.fieldIds) {
      const field = spec.fields.find((candidate) => candidate.id === fieldId);
      if (field) {
        assertSupportedGlyphs(field.label, `field label "${field.label}"`);
        const resolved = resolveFieldValue(field, spec.values);
        if (resolved.text !== null) {
          assertSupportedGlyphs(resolved.text, `value of field "${field.id}"`, {
            allowNewlines: field.type === "textarea",
          });
        }
      }
    }
  }

  const document = await PDFDocument.create();
  const bodyFont = document.embedStandardFont(StandardFonts.Helvetica);
  const headingFont = document.embedStandardFont(StandardFonts.HelveticaBold);
  const form = document.getForm();
  const accent = accentColor(spec.theme.accentColor);

  const manifestFields: PdfRenderFormFieldEntry[] = [];
  const seenFieldNames = new Set<string>();

  for (let pageIndex = 0; pageIndex < spec.pages.length; pageIndex += 1) {
    const pageSpec = spec.pages[pageIndex]!;
    const geometry = pageGeometry(
      pageSpec.layout.orientation,
      pageSpec.layout.sizeIntent,
    );
    const page = document.addPage([geometry.width, geometry.height]);
    drawPageFrame(page, headingFont, spec.metadata.title, geometry);
    renderPageSections(
      page,
      pageSpec.layout.sectionIds,
      spec,
      geometry,
      bodyFont,
      headingFont,
      form,
      accent,
      pageIndex,
      manifestFields,
      seenFieldNames,
    );
  }

  document.setTitle(spec.metadata.title);
  document.setProducer(RENDER_PRODUCER);
  document.setCreator(RENDER_CREATOR);
  document.setCreationDate(RENDER_METADATA_EPOCH);
  document.setModificationDate(RENDER_METADATA_EPOCH);
  form.updateFieldAppearances(bodyFont);

  let bytes: Uint8Array;
  try {
    bytes = await document.save({
      useObjectStreams: false,
      updateFieldAppearances: true,
    });
  } catch (error) {
    throw new CharacterSheetPdfRenderError(
      "pdf_generation_failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  return { bytes, manifest: buildManifest(spec.pages.length, manifestFields) };
}

function drawPageFrame(
  page: PDFPage,
  headingFont: PDFFont,
  sheetTitle: string,
  geometry: { width: number; height: number },
): void {
  const width = geometry.width;
  const height = geometry.height;
  const titleSize = fitSectionTitle(
    headingFont,
    sheetTitle,
    contentArea(geometry),
    "Sheet title",
  );
  const titleBaseline = height - PAGE_MARGIN - 12;

  page.drawText(sheetTitle, {
    x: PAGE_MARGIN,
    y: titleBaseline,
    size: titleSize,
    font: headingFont,
    color: HEADER_TEXT,
  });

  page.drawLine({
    start: { x: PAGE_MARGIN, y: titleBaseline - 10 },
    end: { x: width - PAGE_MARGIN, y: titleBaseline - 10 },
    thickness: 1.2,
    color: RULE,
  });
}

function renderPageSections(
  page: PDFPage,
  sectionIds: readonly string[],
  spec: CharacterSheetSpec,
  geometry: { width: number; height: number },
  bodyFont: PDFFont,
  headingFont: PDFFont,
  form: PDFForm,
  accent: ReturnType<typeof rgb>,
  pageIndex: number,
  manifestFields: PdfRenderFormFieldEntry[],
  seenFieldNames: Set<string>,
): void {
  const width = geometry.width;
  const height = geometry.height;
  const sectionsById = new Map(spec.sections.map((s) => [s.id, s]));
  const maxContentBottom = height - PAGE_MARGIN - FOOTER_HEIGHT;

  let topCursor = PAGE_MARGIN + HEADER_HEIGHT;

  for (const sectionId of sectionIds) {
    const section = sectionsById.get(sectionId);
    if (!section) {
      throw new CharacterSheetPdfRenderError(
        "invalid_spec",
        `Page "${pageIndex + 1}" references unknown section "${sectionId}".`,
      );
    }

    const planned = layoutSection(section, section.layout, spec, geometry);
    const sectionHeight =
      SECTION_TITLE_HEIGHT + planned.rowCount * ROW_HEIGHT + SECTION_GAP;
    const sectionBottom = topCursor + sectionHeight;
    if (sectionBottom > maxContentBottom) {
      throw new CharacterSheetPdfRenderError(
        "layout_overflow",
        `Section "${section.id}" on page ${pageIndex + 1} does not fit the ` +
          `remaining page height (needs ${Math.round(sectionHeight)}pt, ` +
          `${Math.round(maxContentBottom - topCursor)}pt available).`,
      );
    }

    // Section title band.
    const titleSize = fitSectionTitle(
      headingFont,
      section.title,
      contentArea(geometry),
      `Section title "${section.title}"`,
    );
    page.drawText(section.title, {
      x: PAGE_MARGIN,
      y: height - topCursor - 8,
      size: titleSize,
      font: headingFont,
      color: INK,
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: height - topCursor - 14 },
      end: { x: width - PAGE_MARGIN, y: height - topCursor - 14 },
      thickness: 0.8,
      color: accent,
    });

    for (const placed of planned.fields) {
      drawFieldControl(
        page,
        placed,
        bodyFont,
        geometry,
        spec,
        form,
        pageIndex,
        manifestFields,
        seenFieldNames,
      );
    }

    topCursor += sectionHeight;
  }
}

function drawFieldControl(
  page: PDFPage,
  placed: PlacedField,
  font: PDFFont,
  geometry: { width: number; height: number },
  spec: CharacterSheetSpec,
  form: PDFForm,
  pageIndex: number,
  manifestFields: PdfRenderFormFieldEntry[],
  seenFieldNames: Set<string>,
): void {
  const field = placed.field;
  const resolved = resolveFieldValue(field, spec.values);

  // Widget position in pdf-lib bottom-up coordinates.
  const widgetBottomY =
    geometry.height - (placed.widgetYTop + placed.widgetHeight);
  const widgetTopY = widgetBottomY + placed.widgetHeight;

  // Label drawn in the reserved band above the widget, wrapped deterministically.
  const fittedLabel = fitLabel(
    font,
    field.label,
    placed.widgetWidth,
    `Label for field "${field.id}"`,
  );
  const firstLineBaseline = widgetTopY + 6;
  for (let index = 0; index < fittedLabel.lines.length; index += 1) {
    const line = fittedLabel.lines[index]!;
    page.drawText(line, {
      x: placed.widgetX,
      y:
        firstLineBaseline +
        (fittedLabel.lines.length - 1 - index) * (fittedLabel.fontSize + 2),
      size: fittedLabel.fontSize,
      font,
      color: INK,
    });
  }

  const fieldName = pdfFieldNameFor(field.id);
  if (seenFieldNames.has(fieldName)) {
    throw new CharacterSheetPdfRenderError(
      "duplicate_form_field",
      `The AcroForm field "${fieldName}" is referenced more than once.`,
    );
  }
  seenFieldNames.add(fieldName);

  const control = form.createTextField(fieldName);
  if (field.type === "textarea") {
    control.enableMultiline();
  }
  const fontSize =
    resolved.text !== null
      ? fitFieldValue(
          font,
          resolved.text,
          Math.max(1, placed.widgetWidth - 4),
          `Value of field "${field.id}"`,
        )
      : DEFAULT_FIELD_FONT_SIZE;
  // Give the field an explicit default appearance before it is added to the
  // page. pdf-lib's `setFontSize` asserts on a freshly created field because
  // it has no /DA entry yet. `addToPage` appends the text color operator after
  // the `Tf` operator written here, so the color still wins.
  control.acroField.setDefaultAppearance(`/${font.name} ${fontSize} Tf 0 g`);
  if (resolved.text !== null) {
    control.setText(resolved.text);
  }
  if (!resolved.editable) {
    control.enableReadOnly();
  }
  control.addToPage(page, {
    x: placed.widgetX,
    y: widgetBottomY,
    width: placed.widgetWidth,
    height: placed.widgetHeight,
    borderColor: FIELD_BORDER,
    borderWidth: 0.6,
    backgroundColor: resolved.editable ? FIELD_FILL : READONLY_FILL,
    textColor: FIELD_TEXT,
  });
  manifestFields.push({
    canonicalKey: field.id,
    pdfFieldName: fieldName,
    pageIndex,
    editable: resolved.editable,
  });
}
