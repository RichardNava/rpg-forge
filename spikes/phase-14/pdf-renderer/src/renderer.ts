import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFForm,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

type FieldType = "text" | "multiline" | "checkbox" | "radio" | "dropdown";

interface LayoutBase {
  readonly name: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TextLayout extends LayoutBase {
  readonly fieldType: "text" | "multiline";
}

interface CheckBoxLayout extends LayoutBase {
  readonly fieldType: "checkbox";
}

interface ChoiceLayout extends LayoutBase {
  readonly fieldType: "radio" | "dropdown";
  readonly options: readonly string[];
}

export type SheetLayoutField = TextLayout | CheckBoxLayout | ChoiceLayout;

export interface SheetLayoutPage {
  readonly pageNumber: number;
  readonly title: string;
  readonly fields: readonly SheetLayoutField[];
}

export const sampleLayout: readonly SheetLayoutPage[] = [
  {
    pageNumber: 1,
    title: "Character Overview",
    fields: [
      {
        name: "character-name",
        label: "Character Name",
        x: 72,
        y: 652,
        width: 220,
        height: 24,
        fieldType: "text",
      },
      {
        name: "archetype",
        label: "Archetype",
        x: 320,
        y: 652,
        width: 220,
        height: 24,
        fieldType: "text",
      },
      {
        name: "strength",
        label: "Strength",
        x: 72,
        y: 576,
        width: 100,
        height: 24,
        fieldType: "text",
      },
      {
        name: "health",
        label: "Health",
        x: 200,
        y: 576,
        width: 100,
        height: 24,
        fieldType: "text",
      },
      {
        name: "ready",
        label: "Ready for play",
        x: 72,
        y: 507,
        width: 16,
        height: 16,
        fieldType: "checkbox",
      },
      {
        name: "stance",
        label: "Stance",
        x: 72,
        y: 445,
        width: 220,
        height: 18,
        fieldType: "radio",
        options: ["A", "B"],
      },
      {
        name: "travel-style",
        label: "Travel Style",
        x: 72,
        y: 370,
        width: 220,
        height: 24,
        fieldType: "dropdown",
        options: ["On foot", "Mounted", "River"],
      },
    ],
  },
  {
    pageNumber: 2,
    title: "Skills, Equipment, and Notes",
    fields: [
      {
        name: "skills",
        label: "Skills",
        x: 72,
        y: 522,
        width: 468,
        height: 105,
        fieldType: "multiline",
      },
      {
        name: "equipment",
        label: "Equipment",
        x: 72,
        y: 327,
        width: 468,
        height: 105,
        fieldType: "multiline",
      },
      {
        name: "notes",
        label: "Notes",
        x: 72,
        y: 100,
        width: 468,
        height: 137,
        fieldType: "multiline",
      },
    ],
  },
];

const npcValues: Readonly<Record<string, string | boolean>> = {
  "character-name": "Mira Thorn",
  archetype: "Trail Ranger",
  strength: "14",
  health: "18",
  ready: true,
  stance: "B",
  "travel-style": "On foot",
  skills: "Tracking +3\nSurvival +2\nArchery +2",
  equipment: "Longbow\nRope\nField journal",
  notes: "A prefilled NPC sample. The fields remain editable after opening.",
};

export async function renderCharacterSheetSpike(options: {
  readonly prefilled: boolean;
  readonly layout?: readonly SheetLayoutPage[];
  readonly values?: Readonly<Record<string, string | boolean>>;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(
    options.prefilled
      ? "RPG Forge Phase 14 NPC PDF Spike"
      : "RPG Forge Phase 14 Character Sheet PDF Spike",
  );
  document.setAuthor("RPG Forge");
  document.setSubject("Workerd AcroForm renderer technical spike");
  document.setCreationDate(new Date("2026-08-17T00:00:00.000Z"));
  document.setModificationDate(new Date("2026-08-17T00:00:00.000Z"));

  const font = await document.embedFont(StandardFonts.Helvetica);
  const headingFont = await document.embedFont(StandardFonts.HelveticaBold);
  const form = document.getForm();
  const layout = options.layout ?? sampleLayout;
  const values = options.values ?? (options.prefilled ? npcValues : {});

  for (const layoutPage of layout) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageFrame(page, layoutPage.title, layoutPage.pageNumber, headingFont);

    for (const layout of layoutPage.fields) {
      drawAndAttachField(page, form, font, layout, values);
    }
  }

  form.updateFieldAppearances(font);
  return document.save({
    useObjectStreams: false,
    updateFieldAppearances: true,
  });
}

function drawPageFrame(
  page: PDFPage,
  title: string,
  pageNumber: number,
  headingFont: PDFFont,
): void {
  page.drawRectangle({
    x: 42,
    y: 42,
    width: PAGE_WIDTH - 84,
    height: PAGE_HEIGHT - 84,
    borderColor: rgb(0.14, 0.19, 0.24),
    borderWidth: 1.2,
  });
  page.drawText("RPG Forge - PDF Renderer Spike", {
    x: 72,
    y: 730,
    size: 17,
    font: headingFont,
    color: rgb(0.09, 0.14, 0.2),
  });
  page.drawText(title, {
    x: 72,
    y: 704,
    size: 10,
    font: headingFont,
    color: rgb(0.24, 0.3, 0.36),
  });
  page.drawText(`PAGE ${pageNumber}`, {
    x: 484,
    y: 704,
    size: 10,
    font: headingFont,
    color: rgb(0.24, 0.3, 0.36),
  });
  page.drawLine({
    start: { x: 72, y: 692 },
    end: { x: 540, y: 692 },
    thickness: 1,
    color: rgb(0.2, 0.28, 0.35),
  });
}

function drawAndAttachField(
  page: PDFPage,
  form: PDFForm,
  font: PDFFont,
  layout: SheetLayoutField,
  values: Readonly<Record<string, string | boolean>>,
): void {
  if (layout.fieldType === "checkbox") {
    drawCheckBox(page, layout, font);
    const field = form.createCheckBox(layout.name);
    field.addToPage(page, widgetOptions(layout));
    if (values[layout.name] === true) {
      field.check();
    }
    return;
  }

  if (layout.fieldType === "radio") {
    drawRadioGroup(page, layout, font);
    const field = form.createRadioGroup(layout.name);
    const optionWidth = layout.width / layout.options.length;

    for (const [index, option] of layout.options.entries()) {
      const optionX = layout.x + optionWidth * index;
      field.addOptionToPage(option, page, {
        x: optionX,
        y: layout.y,
        width: layout.height,
        height: layout.height,
        borderColor: rgb(0.14, 0.19, 0.24),
        borderWidth: 0.6,
      });
    }

    const selected = values[layout.name];
    if (typeof selected === "string" && layout.options.includes(selected)) {
      field.select(selected);
    }
    return;
  }

  drawTextFrame(page, layout, font);

  if (layout.fieldType === "dropdown") {
    const field = form.createDropdown(layout.name);
    field.addOptions([...layout.options]);
    const selected = values[layout.name];
    if (typeof selected === "string" && layout.options.includes(selected)) {
      field.select(selected);
    }
    field.addToPage(page, widgetOptions(layout));
    return;
  }

  const field = form.createTextField(layout.name);
  if (layout.fieldType === "multiline") {
    field.enableMultiline();
  }
  const value = values[layout.name];
  if (typeof value === "string") {
    field.setText(value);
  }
  field.addToPage(page, widgetOptions(layout));
  field.setFontSize(10);
}

function drawTextFrame(
  page: PDFPage,
  layout: TextLayout | ChoiceLayout,
  font: PDFFont,
): void {
  page.drawText(layout.label, {
    x: layout.x,
    y: layout.y + layout.height + 6,
    size: 10,
    font,
    color: rgb(0.1, 0.13, 0.16),
  });
  // Static geometry keeps the form usable with a pen even if a viewer hides widgets.
  page.drawRectangle({
    x: layout.x - 1,
    y: layout.y - 1,
    width: layout.width + 2,
    height: layout.height + 2,
    borderColor: rgb(0.14, 0.19, 0.24),
    borderWidth: 0.8,
  });
}

function drawCheckBox(
  page: PDFPage,
  layout: CheckBoxLayout,
  font: PDFFont,
): void {
  page.drawRectangle({
    x: layout.x - 1,
    y: layout.y - 1,
    width: layout.width + 2,
    height: layout.height + 2,
    borderColor: rgb(0.14, 0.19, 0.24),
    borderWidth: 0.8,
  });
  page.drawText(layout.label, {
    x: layout.x + layout.width + 10,
    y: layout.y + 3,
    size: 10,
    font,
    color: rgb(0.1, 0.13, 0.16),
  });
}

function drawRadioGroup(
  page: PDFPage,
  layout: ChoiceLayout,
  font: PDFFont,
): void {
  page.drawText(layout.label, {
    x: layout.x,
    y: layout.y + layout.height + 7,
    size: 10,
    font,
    color: rgb(0.1, 0.13, 0.16),
  });

  const optionWidth = layout.width / layout.options.length;
  for (const [index, option] of layout.options.entries()) {
    const optionX = layout.x + optionWidth * index;
    page.drawCircle({
      x: optionX + layout.height / 2,
      y: layout.y + layout.height / 2,
      size: layout.height / 2 + 1,
      borderColor: rgb(0.14, 0.19, 0.24),
      borderWidth: 0.8,
    });
    page.drawText(option, {
      x: optionX + layout.height + 7,
      y: layout.y + 4,
      size: 10,
      font,
      color: rgb(0.1, 0.13, 0.16),
    });
  }
}

function widgetOptions(layout: SheetLayoutField): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly borderColor: ReturnType<typeof rgb>;
  readonly borderWidth: number;
  readonly backgroundColor: ReturnType<typeof rgb>;
  readonly textColor: ReturnType<typeof rgb>;
} {
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    borderColor: rgb(0.14, 0.19, 0.24),
    borderWidth: 0.4,
    backgroundColor: rgb(1, 1, 1),
    textColor: rgb(0.05, 0.05, 0.05),
  };
}
