import {
  CharacterSheetDraftV2Schema,
  resolveEffectiveDraftLayoutV1,
  type CharacterSheetDraftV2,
  type DraftField,
  type DraftLayoutNodeV1,
} from "@repo/character-sheet-draft";
import {
  FinalPresentationPlanV1Schema,
  FinalPresentationStyleV1Schema,
  getStyleProfile,
  type FinalPresentationPlanV1,
  type FinalPresentationStyleV1,
  type StyleProfileV1,
} from "@repo/character-sheet-generation";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFForm,
  type PDFPage,
} from "pdf-lib";

import { CharacterSheetPdfRenderError } from "./errors.js";
import { assertSupportedGlyphs } from "./glyphs.js";
import { fitFieldValue, fitLabel, fitSectionTitle } from "./text.js";
import { pdfFieldNameFor } from "./values.js";
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  LABEL_BAND_HEIGHT,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  PAGE_MARGIN,
  ROW_HEIGHT,
  SECTION_GAP,
  SECTION_TITLE_HEIGHT,
  WIDGET_PADDING,
} from "./layout.js";
import {
  RENDER_CREATOR,
  RENDER_METADATA_EPOCH,
  RENDER_PRODUCER,
} from "./renderer.js";

export interface StyledDraftNodeState {
  readonly key: string;
  readonly kind: "field" | "section" | "slot";
  readonly parentKey: string | null;
  readonly canonicalOrder: number;
  readonly layout: DraftLayoutNodeV1;
  readonly containerColumns: number;
  readonly valueState: "explicit" | "generated" | "blank" | "n/a";
  readonly editable: boolean;
  /** Present only for slot nodes. */
  readonly slotType?: "portrait";
  /** Frame aspect from layout.slotDetails; present only for slot nodes. */
  readonly aspectRatio?: "1:1" | "3:4" | "4:5" | "16:9";
  /** Portrait content state; "asset" only when resolved image bytes exist. */
  readonly contentState?: "empty" | "asset";
}

export interface StyledDraftPdfManifest {
  readonly schemaVersion: "1";
  readonly draftId: string;
  readonly draftVersion: number;
  readonly semantic: {
    readonly nodes: readonly StyledDraftNodeState[];
  };
  readonly presentation: {
    readonly style: FinalPresentationStyleV1;
    readonly variant: string;
    readonly ornamentDensity: string;
    readonly contrast: string;
    readonly sectionEmphasis: string;
    readonly fieldEmphasis: string;
  };
}

export interface StyledDraftPortraitInput {
  readonly slotKey: string;
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg";
}

export interface RenderStyledDraftPdfInput {
  readonly draft: CharacterSheetDraftV2;
  readonly resolvedValues: {
    readonly values: Record<string, unknown>;
    readonly generatedKeys?: readonly string[];
  };
  readonly presentation: FinalPresentationPlanV1;
  readonly profile: StyleProfileV1;
  /**
   * Optional resolved portrait image. The renderer never fetches URLs, calls
   * AI, reads R2, or interprets the source kind: it only receives validated
   * image bytes plus the slot they belong to.
   */
  readonly portrait?: StyledDraftPortraitInput | null;
}

export interface RenderStyledDraftPdfOutput {
  readonly bytes: Uint8Array;
  readonly manifest: StyledDraftPdfManifest;
}

export interface StyledDraftPlannedMember {
  readonly kind: "field" | "section" | "slot";
  readonly key: string;
  readonly geometry: DraftLayoutNodeV1;
  readonly row: number;
  readonly x: number;
  readonly w: number;
  readonly height: number;
  readonly nested: StyledDraftPlannedContainer | null;
}

const PORTRAIT_ASPECT_HEIGHT: Record<"1:1" | "3:4" | "4:5" | "16:9", number> = {
  "1:1": 1,
  "3:4": 4 / 3,
  "4:5": 5 / 4,
  "16:9": 9 / 16,
};

export function portraitSlotFrameHeight(width: number, aspectRatio: "1:1" | "3:4" | "4:5" | "16:9"): number {
  return Math.max(40, width) * (PORTRAIT_ASPECT_HEIGHT[aspectRatio] ?? 4 / 3) + 8;
}

export interface StyledDraftPlannedRow {
  readonly members: readonly StyledDraftPlannedMember[];
  readonly height: number;
  readonly gapBefore: number;
  readonly yTop: number;
}

export interface StyledDraftPlannedContainer {
  readonly rows: readonly StyledDraftPlannedRow[];
  readonly totalHeight: number;
}

function fieldBlockHeight(field: DraftField, geometry: DraftLayoutNodeV1): number {
  const rowSpan = Math.max(geometry.rowSpan, 1);
  const widgetHeight =
    (field.type === "textarea" || field.type === "list" ? ROW_HEIGHT * 2 : ROW_HEIGHT) * rowSpan -
    LABEL_BAND_HEIGHT;
  return LABEL_BAND_HEIGHT + widgetHeight + 6;
}

/**
 * Container-local deterministic grid planning for a Draft V2 snapshot.
 *
 * Each Root/Section container packs its DIRECT children in canonical sibling
 * order using its own column count. Siblings in different columns share
 * visual rows; `rowSpan` reserves rows; `breakBefore` begins a new row;
 * nested Section grids are planned independently inside their grid cell.
 * Derived PDF coordinates are renderer-only: nothing is persisted.
 */
export function planStyledDraftLayout(
  draft: CharacterSheetDraftV2,
  x0: number = PAGE_MARGIN,
  width: number = LETTER_WIDTH - PAGE_MARGIN * 2,
): StyledDraftPlannedContainer {
  const draftParsed = CharacterSheetDraftV2Schema.safeParse(draft);
  if (!draftParsed.success) {
    throw new CharacterSheetPdfRenderError("invalid_draft", "The provided draft failed V2 validation.");
  }
  const valid = draftParsed.data;
  const layout = resolveEffectiveDraftLayoutV1(valid);
  const fieldsByKey = new Map(valid.fields.map((f) => [f.key, f]));
  const containerColumnsFor = (parentKey: string | null): number => {
    if (parentKey === null) return layout.root.columns;
    return layout.sections[parentKey]?.columns ?? 1;
  };
  const geometryOf = (key: string): DraftLayoutNodeV1 =>
    layout.nodes[key] ?? { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false };

  const planContainer = (
    parentKey: string | null,
    originX: number,
    originWidth: number,
    columns: number,
    baseYTop: number,
  ): StyledDraftPlannedContainer => {
    const cols = Math.max(1, Math.min(columns, 4));
    const direct = valid.structure.filter((p) => (p.parentKey ?? null) === parentKey);
    const occupied: boolean[][] = [];
    const assignments: { kind: "field" | "section" | "slot"; key: string; geometry: DraftLayoutNodeV1; row: number }[] = [];
    let cursor = 0;
    for (const child of direct) {
      const g = geometryOf(child.key);
      const colStart = Math.min(Math.max(g.columnStart, 1), cols);
      const colSpan = Math.min(Math.max(g.columnSpan, 1), cols - colStart + 1);
      const rowSpan = Math.max(g.rowSpan, 1);
      if (g.breakBefore) cursor = occupied.length;
      const fits = (r: number): boolean => {
        for (let rr = r; rr < r + rowSpan; rr += 1) {
          for (let cc = colStart - 1; cc < colStart - 1 + colSpan; cc += 1) {
            if (occupied[rr]?.[cc] === true) return false;
          }
        }
        return true;
      };
      let r = cursor;
      while (!fits(r)) r += 1;
      for (let rr = r; rr < r + rowSpan; rr += 1) {
        occupied[rr] ??= [];
        for (let cc = colStart - 1; cc < colStart - 1 + colSpan; cc += 1) {
          occupied[rr]![cc] = true;
        }
      }
      assignments.push({ kind: child.kind, key: child.key, geometry: g, row: r });
    }

    const byRow = new Map<number, typeof assignments>();
    for (const a of assignments) {
      const list = byRow.get(a.row) ?? [];
      list.push(a);
      byRow.set(a.row, list);
    }
    const rowIndices = [...byRow.keys()].sort((a, b) => a - b);
    const columnWidth = originWidth / cols;
    const rows: StyledDraftPlannedRow[] = [];
    let yTop = baseYTop;
    let first = true;
    for (const r of rowIndices) {
      const starters = byRow.get(r)!;
      let height = 0;
      const members: StyledDraftPlannedMember[] = [];
      for (const s of starters) {
        const colStart = Math.min(Math.max(s.geometry.columnStart, 1), cols);
        const colSpan = Math.min(Math.max(s.geometry.columnSpan, 1), cols - colStart + 1);
        const x = originX + (colStart - 1) * columnWidth + WIDGET_PADDING;
        const w = Math.max(40, colSpan * columnWidth - WIDGET_PADDING * 2);
        let memberHeight: number;
        let nested: StyledDraftPlannedContainer | null = null;
        if (s.kind === "section") {
          const nestedCols = layout.sections[s.key]?.columns ?? 1;
          nested = planContainer(s.key, x + 12, Math.max(40, w - 12), nestedCols, 0);
          memberHeight = SECTION_TITLE_HEIGHT + SECTION_GAP + nested.totalHeight;
        } else if (s.kind === "slot") {
          const aspect = layout.slotDetails?.[s.key]?.aspectRatio ?? "3:4";
          memberHeight = portraitSlotFrameHeight(w, aspect);
        } else {
          const field = fieldsByKey.get(s.key);
          if (!field) {
            throw new CharacterSheetPdfRenderError("invalid_draft", `Field "${s.key}" not found.`);
          }
          memberHeight = fieldBlockHeight(field, s.geometry);
        }
        height = Math.max(height, memberHeight);
        members.push({
          kind: s.kind,
          key: s.key,
          geometry: s.geometry,
          row: r,
          x,
          w,
          height: memberHeight,
          nested,
        });
      }
      const gapBefore = first ? 0 : starters.some((s) => s.geometry.breakBefore) ? 8 : 4;
      first = false;
      yTop += gapBefore;
      rows.push({ members, height, gapBefore, yTop });
      yTop += height;
    }
    return { rows, totalHeight: yTop - baseYTop };
  };

  return planContainer(null, x0, width, containerColumnsFor(null), 0);
}

function parseColor(hex: string): ReturnType<typeof rgb> {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return rgb(0, 0, 0);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return rgb(r, g, b);
}

function draftTextValue(field: DraftField, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (Array.isArray(raw)) return raw.join("\n");
  throw new CharacterSheetPdfRenderError(
    "unsupported_field_value",
    `Field "${field.key}" has a non-scalar value that cannot be rendered.`,
  );
}

export async function renderStyledCharacterSheetPdf(
  input: RenderStyledDraftPdfInput,
): Promise<RenderStyledDraftPdfOutput> {
  const draftParsed = CharacterSheetDraftV2Schema.safeParse(input.draft);
  if (!draftParsed.success) {
    throw new CharacterSheetPdfRenderError("invalid_draft", "The provided draft failed V2 validation.");
  }
  const draft = draftParsed.data;

  const planParsed = FinalPresentationPlanV1Schema.safeParse(input.presentation);
  if (!planParsed.success) {
    throw new CharacterSheetPdfRenderError("invalid_presentation_plan", "The presentation plan failed validation.");
  }
  const plan = planParsed.data;

  const styleParsed = FinalPresentationStyleV1Schema.safeParse(plan.style);
  if (!styleParsed.success) {
    throw new CharacterSheetPdfRenderError("unsupported_style", `Unsupported presentation style: ${String(plan.style)}`);
  }
  if (input.profile.key !== plan.style) {
    throw new CharacterSheetPdfRenderError(
      "invalid_presentation_plan",
      "Presentation plan style does not match the style profile.",
    );
  }
  const profile = input.profile;
  void getStyleProfile(plan.style);

  const layout = resolveEffectiveDraftLayoutV1(draft);
  const generated = new Set(input.resolvedValues.generatedKeys ?? []);

  const fieldsByKey = new Map(draft.fields.map((f) => [f.key, f]));
  const sectionsByKey = new Map(draft.sections.map((s) => [s.key, s]));

  // Generated character name (14.14): a resolved character_name value takes
  // precedence for the final PDF title without mutating the Draft.
  const resolvedName = input.resolvedValues.values["character_name"];
  const displayName =
    typeof resolvedName === "string" && resolvedName.trim() !== ""
      ? resolvedName
      : (draft.characterName ?? "Character Sheet");
  assertSupportedGlyphs(displayName, "sheet title");
  for (const section of draft.sections) {
    assertSupportedGlyphs(section.title, `section title "${section.title}"`);
  }
  for (const field of draft.fields) {
    assertSupportedGlyphs(field.label, `field label "${field.label}"`);
    const raw = input.resolvedValues.values[field.key];
    if (raw !== undefined && raw !== null) {
      const text = draftTextValue(field, raw);
      if (text !== null) {
        assertSupportedGlyphs(text, `value of field "${field.key}"`, {
          allowNewlines: field.type === "textarea" || field.type === "list",
        });
      }
      if (field.type === "choice" && field.options) {
        for (const option of field.options) assertSupportedGlyphs(option, `choice option of "${field.key}"`);
      }
    }
  }

  const document = await PDFDocument.create();
  const isSciFi = plan.style === "sci-fi";
  const bodyFont = await document.embedStandardFont(isSciFi ? StandardFonts.Courier : StandardFonts.Helvetica);
  const headingFont = await document.embedStandardFont(
    isSciFi ? StandardFonts.CourierBold : StandardFonts.HelveticaBold,
  );
  const form = document.getForm();

  const ink = parseColor(profile.palette.ink);

  const page = document.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  drawStyledBackground(page, profile, plan);
  drawStyledFrame(page, profile);

  const title = displayName;
  const titleSize = fitSectionTitle(headingFont, title, LETTER_WIDTH - PAGE_MARGIN * 2, "Sheet title");
  page.drawText(title, {
    x: PAGE_MARGIN,
    y: LETTER_HEIGHT - PAGE_MARGIN - 12,
    size: titleSize,
    font: headingFont,
    color: ink,
  });
  drawStyledTitleRule(page, profile, plan);

  const semanticNodes: StyledDraftNodeState[] = [];
  const seenFieldNames = new Set<string>();

  const contentTop = PAGE_MARGIN + HEADER_HEIGHT;
  const maxBottom = LETTER_HEIGHT - PAGE_MARGIN - FOOTER_HEIGHT;
  const availableHeight = maxBottom - contentTop;

  const containerColumnsFor = (parentKey: string | null): number => {
    if (parentKey === null) return layout.root.columns;
    return layout.sections[parentKey]?.columns ?? 1;
  };
  const geometryOf = (key: string): DraftLayoutNodeV1 =>
    layout.nodes[key] ?? { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false };

  const rootPlan = planStyledDraftLayout(draft, PAGE_MARGIN, LETTER_WIDTH - PAGE_MARGIN * 2);
  if (rootPlan.totalHeight > availableHeight) {
    throw new CharacterSheetPdfRenderError(
      "layout_overflow",
      `Draft content needs ${Math.round(rootPlan.totalHeight)}pt but only ${Math.round(availableHeight)}pt fit the page.`,
    );
  }

  // Draw pass mirrors planStyledDraftLayout row coordinates, offset to the
  // content origin. Row yTop values are plan-relative (from y=0), so shift
  // them by contentTop.
  const drawPlannedContainer = async (
    planned: StyledDraftPlannedContainer,
    yOffset: number,
  ): Promise<void> => {
    for (const row of planned.rows) {
      const cursor = row.yTop + yOffset;
      for (const member of row.members) {
        if (member.kind === "section") {
          const section = sectionsByKey.get(member.key);
          if (!section) {
            throw new CharacterSheetPdfRenderError("invalid_draft", `Section "${member.key}" not found.`);
          }
          drawStyledSectionHeader(
            page,
            section.title,
            member.x,
            LETTER_HEIGHT - cursor - 8,
            member.w,
            headingFont,
            profile,
            plan,
          );
          if (member.nested !== null && member.nested.rows.length > 0) {
            const nestedOrigin = member.nested.rows[0]!.yTop;
            await drawPlannedContainer(
              member.nested,
              cursor + SECTION_TITLE_HEIGHT + SECTION_GAP - nestedOrigin,
            );
          }
        } else if (member.kind === "slot") {
          const aspect = layout.slotDetails?.[member.key]?.aspectRatio ?? "3:4";
          const hasImage =
            input.portrait !== undefined &&
            input.portrait !== null &&
            input.portrait.slotKey === member.key;
          await drawPortraitSlotFrame(
            document,
            page,
            member.x,
            cursor,
            Math.max(60, member.w),
            member.height,
            aspect,
            hasImage ? input.portrait! : null,
            headingFont,
            profile,
            plan,
          );
        } else {
          const field = fieldsByKey.get(member.key);
          if (!field) {
            throw new CharacterSheetPdfRenderError("invalid_draft", `Field "${member.key}" not found.`);
          }
          const raw = input.resolvedValues.values[field.key];
          const valueState =
            generated.has(field.key) ? "generated" : raw === undefined || raw === null ? "blank" : "explicit";
          const editable = valueState === "blank" && field.type !== "label" && field.locked !== true;
          const widgetHeight =
            (field.type === "textarea" || field.type === "list" ? ROW_HEIGHT * 2 : ROW_HEIGHT) *
              Math.max(member.geometry.rowSpan, 1) -
            LABEL_BAND_HEIGHT;
          drawDraftFieldControl(
            page,
            form,
            field,
            raw,
            valueState,
            editable,
            member.x,
            cursor,
            Math.max(60, member.w),
            widgetHeight,
            bodyFont,
            profile,
            plan,
            seenFieldNames,
          );
        }
      }
    }
  };

  await drawPlannedContainer(rootPlan, contentTop);

  // Semantic manifest walk in canonical preorder (independent of drawing).
  for (let order = 0; order < draft.structure.length; order += 1) {
    const placement = draft.structure[order]!;
    const parentKey = placement.parentKey ?? null;
    const geometry = geometryOf(placement.key);
    const columns = containerColumnsFor(parentKey);
    if (placement.kind === "section") {
      semanticNodes.push({
        key: placement.key,
        kind: "section",
        parentKey,
        canonicalOrder: order,
        layout: geometry,
        containerColumns: columns,
        valueState: "n/a",
        editable: false,
      });
      continue;
    }
    if (placement.kind === "slot") {
      const aspect = layout.slotDetails?.[placement.key]?.aspectRatio ?? "3:4";
      const hasImage =
        input.portrait !== undefined &&
        input.portrait !== null &&
        input.portrait.slotKey === placement.key;
      semanticNodes.push({
        key: placement.key,
        kind: "slot",
        parentKey,
        canonicalOrder: order,
        layout: geometry,
        containerColumns: columns,
        valueState: "n/a",
        editable: false,
        slotType: "portrait",
        aspectRatio: aspect,
        contentState: hasImage ? "asset" : "empty",
      });
      continue;
    }
    const field = fieldsByKey.get(placement.key);
    if (!field) {
      throw new CharacterSheetPdfRenderError("invalid_draft", `Field "${placement.key}" not found.`);
    }
    const raw = input.resolvedValues.values[field.key];
    const valueState =
      generated.has(field.key) ? "generated" : raw === undefined || raw === null ? "blank" : "explicit";
    semanticNodes.push({
      key: field.key,
      kind: "field",
      parentKey,
      canonicalOrder: order,
      layout: geometry,
      containerColumns: columns,
      valueState,
      editable: valueState === "blank" && field.type !== "label" && field.locked !== true,
    });
  }

  drawStyledCornerOrnaments(page, profile, plan);
  drawStyledFooter(page, profile, plan);

  document.setTitle(title);
  document.setProducer(RENDER_PRODUCER);
  document.setCreator(RENDER_CREATOR);
  document.setCreationDate(RENDER_METADATA_EPOCH);
  document.setModificationDate(RENDER_METADATA_EPOCH);
  form.updateFieldAppearances(bodyFont);

  let bytes: Uint8Array;
  try {
    bytes = await document.save({ useObjectStreams: false, updateFieldAppearances: true });
  } catch (error) {
    throw new CharacterSheetPdfRenderError(
      "pdf_generation_failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  const manifest: StyledDraftPdfManifest = {
    schemaVersion: "1",
    draftId: draft.draftId,
    draftVersion: draft.version,
    semantic: { nodes: semanticNodes },
    presentation: {
      style: plan.style,
      variant: plan.variant,
      ornamentDensity: plan.ornamentDensity,
      contrast: plan.contrast,
      sectionEmphasis: plan.sectionEmphasis,
      fieldEmphasis: plan.fieldEmphasis,
    },
  };

  return { bytes, manifest };
}

function drawStyledBackground(page: PDFPage, profile: StyleProfileV1, plan: { ornamentDensity: string }): void {
  page.drawRectangle({ x: 0, y: 0, width: LETTER_WIDTH, height: LETTER_HEIGHT, color: parseColor(profile.palette.background) });
  if (profile.backgroundTreatment.type === "parchment" && plan.ornamentDensity !== "none") {
    for (let y = 0; y < LETTER_HEIGHT; y += 6) {
      page.drawLine({
        start: { x: 0, y },
        end: { x: LETTER_WIDTH, y },
        thickness: 0.15,
        color: parseColor(profile.palette.paper),
        opacity: 0.35,
      });
    }
  }
  if (profile.backgroundTreatment.type === "grid" && plan.ornamentDensity !== "none") {
    const grid = parseColor(profile.palette.accent);
    for (let x = 0; x < LETTER_WIDTH; x += 36) {
      page.drawLine({ start: { x, y: 0 }, end: { x, y: LETTER_HEIGHT }, thickness: 0.12, color: grid, opacity: 0.08 });
    }
    for (let y = 0; y < LETTER_HEIGHT; y += 36) {
      page.drawLine({ start: { x: 0, y }, end: { x: LETTER_WIDTH, y }, thickness: 0.12, color: grid, opacity: 0.08 });
    }
  }
}

function drawStyledFrame(page: PDFPage, profile: StyleProfileV1): void {
  const frame = parseColor(profile.pageFrame.color);
  const m = profile.pageFrame.margin;
  if (profile.pageFrame.type === "none") return;
  page.drawRectangle({
    x: m,
    y: m,
    width: LETTER_WIDTH - m * 2,
    height: LETTER_HEIGHT - m * 2,
    borderColor: frame,
    borderWidth: profile.pageFrame.width,
  });
  if (profile.pageFrame.type === "double" || profile.pageFrame.type === "ornate") {
    const inset = 5;
    page.drawRectangle({
      x: m + inset,
      y: m + inset,
      width: LETTER_WIDTH - (m + inset) * 2,
      height: LETTER_HEIGHT - (m + inset) * 2,
      borderColor: frame,
      borderWidth: Math.max(0.5, profile.pageFrame.width / 2),
    });
  }
}

function drawStyledTitleRule(page: PDFPage, profile: StyleProfileV1, plan: { ornamentDensity: string }): void {
  const ruleColor = parseColor(profile.palette.rule);
  const y = LETTER_HEIGHT - PAGE_MARGIN - 22;
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: LETTER_WIDTH - PAGE_MARGIN, y },
    thickness: profile.key === "medieval" ? 1.4 : 1.0,
    color: ruleColor,
  });
  if (profile.key === "medieval" && plan.ornamentDensity !== "none") {
    page.drawLine({
      start: { x: PAGE_MARGIN, y: y - 3 },
      end: { x: LETTER_WIDTH - PAGE_MARGIN, y: y - 3 },
      thickness: 0.5,
      color: ruleColor,
    });
  }
  if (profile.key === "sci-fi") {
    for (let x = PAGE_MARGIN; x < LETTER_WIDTH - PAGE_MARGIN; x += 24) {
      page.drawRectangle({ x, y: y - 6, width: 12, height: 2, color: ruleColor });
    }
  }
}

function drawStyledSectionHeader(
  page: PDFPage,
  title: string,
  x: number,
  y: number,
  width: number,
  headingFont: PDFFont,
  profile: StyleProfileV1,
  plan: { ornamentDensity: string },
): void {
  const heading = parseColor(profile.sectionTreatment.headingColor);
  const ruleColor = parseColor(profile.sectionTreatment.ruleColor);
  const pad = profile.sectionTreatment.padding;
  const size = fitSectionTitle(headingFont, title, Math.max(40, width - pad * 2), `Section title "${title}"`);
  if (profile.sectionTreatment.headingStyle === "framed") {
    page.drawRectangle({
      x,
      y: y - 4,
      width,
      height: SECTION_TITLE_HEIGHT,
      borderColor: ruleColor,
      borderWidth: 0.8,
      color: parseColor(profile.palette.paper),
    });
  }
  page.drawText(title, { x: x + pad, y, size, font: headingFont, color: heading });
  if (profile.sectionTreatment.ruleStyle === "double") {
    page.drawLine({ start: { x, y: y - 6 }, end: { x: x + width, y: y - 6 }, thickness: 0.9, color: ruleColor });
    page.drawLine({ start: { x, y: y - 8.5 }, end: { x: x + width, y: y - 8.5 }, thickness: 0.45, color: ruleColor });
  } else if (profile.sectionTreatment.ruleStyle === "single") {
    page.drawLine({ start: { x, y: y - 6 }, end: { x: x + width, y: y - 6 }, thickness: 0.8, color: ruleColor });
  } else if (profile.sectionTreatment.ruleStyle === "wavy" && plan.ornamentDensity !== "none") {
    for (let dx = 0; dx < width; dx += 10) {
      page.drawLine({
        start: { x: x + dx, y: y - 6 + (dx % 20 === 0 ? 1 : -1) },
        end: { x: x + dx + 8, y: y - 6 + (dx % 20 === 0 ? -1 : 1) },
        thickness: 0.6,
        color: ruleColor,
      });
    }
  }
}

function drawDraftFieldControl(
  page: PDFPage,
  form: PDFForm,
  field: DraftField,
  raw: unknown,
  valueState: "explicit" | "generated" | "blank",
  editable: boolean,
  x: number,
  yTop: number,
  width: number,
  widgetHeight: number,
  bodyFont: PDFFont,
  profile: StyleProfileV1,
  plan: { ornamentDensity: string },
  seenFieldNames: Set<string>,
): void {
  void plan;
  const labelText = profile.fieldTreatment.labelStyle === "small-caps" ? field.label.toUpperCase() : field.label;
  const labelColor = parseColor(profile.fieldTreatment.labelColor);
  const valueColor = parseColor(profile.fieldTreatment.valueColor);
  const border = parseColor(profile.palette.rule);
  const widgetBottomY = LETTER_HEIGHT - (yTop + LABEL_BAND_HEIGHT + widgetHeight);
  const fitted = fitLabel(bodyFont, labelText, Math.max(40, width), `Label for field "${field.key}"`);
  const firstBaseline = LETTER_HEIGHT - yTop + 6;
  for (let i = 0; i < fitted.lines.length; i += 1) {
    page.drawText(fitted.lines[i]!, {
      x,
      y: firstBaseline + (fitted.lines.length - 1 - i) * (fitted.fontSize + 2),
      size: fitted.fontSize,
      font: bodyFont,
      color: labelColor,
    });
  }
  if (profile.fieldTreatment.separator === "colon") {
    page.drawText(":", {
      x: x + Math.min(width - 6, bodyFont.widthOfTextAtSize(fitted.lines.join(" "), fitted.fontSize) + 2),
      y: firstBaseline,
      size: fitted.fontSize,
      font: bodyFont,
      color: parseColor(profile.fieldTreatment.separatorColor),
    });
  }

  const pdfFieldName = pdfFieldNameFor(field.key);
  if (seenFieldNames.has(pdfFieldName)) {
    throw new CharacterSheetPdfRenderError("duplicate_form_field", `The AcroForm field "${pdfFieldName}" is referenced more than once.`);
  }
  seenFieldNames.add(pdfFieldName);

  if (field.type === "label") {
    if (raw !== undefined && raw !== null && String(raw).length > 0) {
      page.drawText(String(raw), {
        x,
        y: LETTER_HEIGHT - yTop - LABEL_BAND_HEIGHT - 12,
        size: 10,
        font: bodyFont,
        color: valueColor,
      });
    }
    return;
  }

  const text = valueState === "blank" ? null : draftTextValue(field, raw);

  if (field.type === "checkbox") {
    const checkbox = form.createCheckBox(pdfFieldName);
    if (raw === true) checkbox.check();
    else checkbox.uncheck();
    if (!editable) checkbox.enableReadOnly();
    checkbox.addToPage(page, {
      x,
      y: widgetBottomY,
      width: 14,
      height: 14,
      borderColor: border,
      borderWidth: 0.7,
      backgroundColor: parseColor(profile.palette.paper),
    });
    return;
  }

  if (field.type === "choice") {
    const options = field.options ?? [];
    if (text !== null && !options.includes(text)) {
      throw new CharacterSheetPdfRenderError(
        "unsupported_field_value",
        `Choice field "${field.key}" has a value outside its declared options.`,
      );
    }
    const dropdown = form.createDropdown(pdfFieldName);
    dropdown.addOptions(options);
    if (text !== null) dropdown.select(text);
    if (!editable) dropdown.enableReadOnly();
    dropdown.addToPage(page, {
      x,
      y: widgetBottomY,
      width,
      height: widgetHeight,
      borderColor: border,
      borderWidth: 0.6,
      backgroundColor: editable ? parseColor(profile.palette.paper) : parseColor(profile.palette.background),
      textColor: valueColor,
    });
    return;
  }

  if (field.type === "list") {
    const listText = Array.isArray(raw) ? (raw as string[]).join("\n") : (text ?? "");
    const control = form.createTextField(pdfFieldName);
    control.enableMultiline();
    const fontSize = listText ? fitFieldValue(bodyFont, listText, Math.max(1, width - 4), `Value of field "${field.key}"`) : 10;
    control.acroField.setDefaultAppearance(`/${bodyFont.name} ${fontSize} Tf 0 g`);
    if (listText) control.setText(listText);
    if (!editable) control.enableReadOnly();
    control.addToPage(page, {
      x,
      y: widgetBottomY,
      width,
      height: widgetHeight,
      borderColor: border,
      borderWidth: 0.6,
      backgroundColor: editable ? parseColor(profile.palette.paper) : parseColor(profile.palette.background),
      textColor: valueColor,
    });
    return;
  }

  if (field.type !== "text" && field.type !== "number" && field.type !== "date" && field.type !== "textarea") {
    throw new CharacterSheetPdfRenderError(
      "unsupported_field_type",
      `Field "${field.key}" has type "${field.type}", which the styled renderer does not support yet.`,
    );
  }
  if (field.type === "date" && text !== null && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new CharacterSheetPdfRenderError(
      "unsupported_field_value",
      `Date field "${field.key}" must use YYYY-MM-DD.`,
    );
  }

  const control = form.createTextField(pdfFieldName);
  if (field.type === "textarea") control.enableMultiline();
  const fontSize = text !== null ? fitFieldValue(bodyFont, text, Math.max(1, width - 4), `Value of field "${field.key}"`) : 10;
  control.acroField.setDefaultAppearance(`/${bodyFont.name} ${fontSize} Tf 0 g`);
  if (text !== null) control.setText(text);
  if (!editable) control.enableReadOnly();
  control.addToPage(page, {
    x,
    y: widgetBottomY,
    width,
    height: widgetHeight,
    borderColor: border,
    borderWidth: 0.6,
    backgroundColor: editable ? parseColor(profile.palette.paper) : parseColor(profile.palette.background),
    textColor: valueColor,
  });
}

function portraitMagicOk(bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function drawPortraitSlotFrame(
  document: PDFDocument,
  page: PDFPage,
  x: number,
  yTop: number,
  width: number,
  height: number,
  aspect: "1:1" | "3:4" | "4:5" | "16:9",
  image: { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" } | null,
  headingFont: PDFFont,
  profile: StyleProfileV1,
  plan: { ornamentDensity: string },
): Promise<void> {
  void aspect;
  const frame = parseColor(profile.pageFrame.color);
  const paperColor = parseColor(profile.palette.paper);
  const labelColor = parseColor(profile.fieldTreatment.labelColor);
  const yBottom = LETTER_HEIGHT - (yTop + height);
  page.drawRectangle({
    x,
    y: yBottom,
    width,
    height,
    borderColor: frame,
    borderWidth: profile.key === "medieval" ? 1.2 : 0.9,
    color: paperColor,
  });
  if (profile.key === "medieval" && plan.ornamentDensity !== "none") {
    page.drawRectangle({
      x: x + 3,
      y: yBottom + 3,
      width: Math.max(1, width - 6),
      height: Math.max(1, height - 6),
      borderColor: frame,
      borderWidth: 0.4,
    });
  }

  if (image === null) {
    const label = "PORTRAIT";
    const size = 9;
    const textWidth = headingFont.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: x + (width - textWidth) / 2,
      y: yBottom + height / 2 - 4,
      size,
      font: headingFont,
      color: labelColor,
    });
    return;
  }

  if (!portraitMagicOk(image.bytes, image.mimeType)) {
    throw new CharacterSheetPdfRenderError(
      "unsupported_field_value",
      "The portrait image bytes do not match their declared image type.",
    );
  }
  const embedded =
    image.mimeType === "image/png"
      ? await document.embedPng(image.bytes)
      : await document.embedJpg(image.bytes);
  const naturalWidth = embedded.width;
  const naturalHeight = embedded.height;
  const scale = Math.min((width - 8) / naturalWidth, (height - 8) / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  page.drawImage(embedded, {
    x: x + (width - drawWidth) / 2,
    y: yBottom + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
}

function drawStyledCornerOrnaments(page: PDFPage, profile: StyleProfileV1, plan: { ornamentDensity: string }): void {
  if (plan.ornamentDensity === "none") return;
  const color = parseColor(profile.palette.accent);
  const m = profile.pageFrame.margin;
  const size = plan.ornamentDensity === "heavy" ? 14 : plan.ornamentDensity === "medium" ? 10 : 7;
  if (profile.key === "medieval") {
    for (const [x, y] of [
      [m + 10, LETTER_HEIGHT - m - 10],
      [LETTER_WIDTH - m - 10, LETTER_HEIGHT - m - 10],
      [m + 10, m + 10],
      [LETTER_WIDTH - m - 10, m + 10],
    ] as const) {
      page.drawEllipse({ x, y, xScale: size / 2, yScale: size / 3, color, borderColor: color, borderWidth: 0.8 });
    }
  } else {
    const arm = size;
    for (const [x, y, sx, sy] of [
      [m, LETTER_HEIGHT - m, 1, -1],
      [LETTER_WIDTH - m, LETTER_HEIGHT - m, -1, -1],
      [m, m, 1, 1],
      [LETTER_WIDTH - m, m, -1, 1],
    ] as const) {
      page.drawLine({ start: { x, y }, end: { x: x + sx * arm, y }, thickness: 1.2, color });
      page.drawLine({ start: { x, y }, end: { x, y: y + sy * arm }, thickness: 1.2, color });
    }
  }
}

function drawStyledFooter(page: PDFPage, profile: StyleProfileV1, plan: FinalPresentationPlanV1): void {
  const ruleColor = parseColor(profile.palette.rule);
  const label = `Final presentation · ${profile.label} · ${plan.variant} · ornaments ${plan.ornamentDensity}`;
  page.drawLine({
    start: { x: PAGE_MARGIN, y: PAGE_MARGIN - 12 },
    end: { x: LETTER_WIDTH - PAGE_MARGIN, y: PAGE_MARGIN - 12 },
    thickness: 0.5,
    color: ruleColor,
  });
  page.drawText(label, { x: PAGE_MARGIN, y: PAGE_MARGIN - 24, size: 7, color: ruleColor });
}
