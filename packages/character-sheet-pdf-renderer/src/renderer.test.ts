import { createHash } from "node:crypto";

import {
  CharacterSheetSpecSchema,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  buildBaseSpec,
  specWithCalculatedField,
  specWithFieldValues,
  specWithMultiplePages,
  specWithUnsupportedFieldType,
  specWithWrongValueType,
} from "./fixtures.js";
import {
  CharacterSheetPdfRenderError,
  PDF_RENDER_ERROR_CODES,
} from "./errors.js";
import { renderCharacterSheetPdf } from "./renderer.js";

async function expectRenderError(
  spec: CharacterSheetSpec,
  code: (typeof PDF_RENDER_ERROR_CODES)[number],
): Promise<void> {
  try {
    await renderCharacterSheetPdf({ spec });
  } catch (error) {
    expect(error).toBeInstanceOf(CharacterSheetPdfRenderError);
    expect((error as CharacterSheetPdfRenderError).code).toBe(code);
    return;
  }
  throw new Error(`Expected render to fail with ${code}, but it succeeded.`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadForm(bytes: Uint8Array) {
  // `updateMetadata: false` stops pdf-lib from overwriting Producer and
  // ModDate on load, so tests can assert the bytes the renderer actually wrote.
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return { document, form: document.getForm() };
}

describe("structural output", () => {
  it("produces a loadable PDF for a baseline spec", async () => {
    const spec = buildBaseSpec();
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1_000);

    const { document } = await loadForm(bytes);
    expect(document.getPageCount()).toBe(spec.pages.length);
    expect(manifest.pageCount).toBe(spec.pages.length);
    expect(manifest.schemaVersion).toBe("1");
  });

  it("registers one AcroForm text field per renderable field with the rpgforge prefix", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Aria", archetype: null },
    });
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });

    expect(manifest.formFields.map((entry) => entry.pdfFieldName)).toEqual([
      "rpgforge.character.name",
      "rpgforge.archetype",
      "rpgforge.strength",
      "rpgforge.dexterity",
      "rpgforge.background",
    ]);

    const { form } = await loadForm(bytes);
    const parsedNames = form.getFields().map((field) => field.getName());
    expect(parsedNames).toEqual(
      manifest.formFields.map((entry) => entry.pdfFieldName),
    );
    expect(parsedNames).toHaveLength(spec.fields.length);
  });

  it("orders manifest entries deterministically by placement order", async () => {
    const spec = buildBaseSpec();
    const first = (await renderCharacterSheetPdf({ spec })).manifest;
    const second = (await renderCharacterSheetPdf({ spec })).manifest;

    expect(first.formFields.map((entry) => entry.canonicalKey)).toEqual(
      second.formFields.map((entry) => entry.canonicalKey),
    );
    const placementOrder = spec.fields
      .slice()
      .sort((a, b) => a.placement.order - b.placement.order)
      .map((field) => field.id);
    expect(first.formFields.map((entry) => entry.canonicalKey)).toEqual(
      placementOrder,
    );
  });

  it("sets fixed document metadata", async () => {
    const spec = buildBaseSpec({ title: "Wyrm Hunt" });
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { document } = await loadForm(bytes);

    expect(document.getTitle()).toBe("Wyrm Hunt");
    expect(document.getProducer()).toBe("RPG Forge");
    expect(document.getCreator()).toBe("RPG Forge Character Sheet Renderer");
    expect(document.getCreationDate()).toBeInstanceOf(Date);
    expect(document.getModificationDate()).toBeInstanceOf(Date);
  });
});

describe("value rendering", () => {
  it("round-trips text field values through the AcroForm", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Aria Stone", archetype: "Ranger" },
    });
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    expect(form.getTextField("rpgforge.character.name").getText()).toBe(
      "Aria Stone",
    );
    expect(form.getTextField("rpgforge.archetype").getText()).toBe("Ranger");
  });

  it("round-trips number field values losslessly", async () => {
    const spec = buildBaseSpec({ values: { strength: 12, dexterity: 9 } });
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    expect(form.getTextField("rpgforge.strength").getText()).toBe("12");
    expect(form.getTextField("rpgforge.dexterity").getText()).toBe("9");
  });

  it("leaves blank (absent or null) values as truly empty controls", async () => {
    const spec = buildBaseSpec();
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    // pdf-lib represents a field with no value as undefined (no /V entry).
    expect(form.getTextField("rpgforge.archetype").getText()).toBeUndefined();
    expect(form.getTextField("rpgforge.strength").getText()).toBeUndefined();
  });

  it("preserves Spanish accented text", async () => {
    const spec = buildBaseSpec({
      title: "Héroe",
      locale: "es-ES",
      values: { "character.name": "María José", archetype: "Máximo" },
    });
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    expect(form.getTextField("rpgforge.character.name").getText()).toBe(
      "María José",
    );
    expect(form.getTextField("rpgforge.archetype").getText()).toBe("Máximo");
  });

  it("renders textarea values as multiline controls", async () => {
    const spec = buildBaseSpec({
      values: { background: "First line.\nSecond line." },
    });
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    const field = form.getTextField("rpgforge.background");
    expect(field.isMultiline()).toBe(true);
    expect(field.getText()).toBe("First line.\nSecond line.");
  });

  it("marks calculated fields read-only and reflects only the snapshot value", async () => {
    const spec = specWithCalculatedField();
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    const calc = form.getTextField("rpgforge.level.calc");
    expect(calc.isReadOnly()).toBe(true);
    expect(calc.getText()).toBe("3");

    const entry = manifest.formFields.find(
      (entry) => entry.canonicalKey === "level.calc",
    );
    expect(entry?.editable).toBe(false);
  });

  it("marks editable fields as editable and writable in the AcroForm", async () => {
    const spec = specWithCalculatedField();
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });
    const { form } = await loadForm(bytes);

    expect(form.getTextField("rpgforge.character.name").isReadOnly()).toBe(
      false,
    );
    expect(
      manifest.formFields.every(
        (entry) => entry.editable === (entry.canonicalKey !== "level.calc"),
      ),
    ).toBe(true);
  });
});

describe("geometry and pages", () => {
  it("defaults to US Letter portrait (612x792)", async () => {
    const spec = buildBaseSpec();
    const { bytes } = await renderCharacterSheetPdf({ spec });
    const { document } = await loadForm(bytes);

    const page = document.getPage(0);
    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
  });

  it("swaps width/height for landscape pages", async () => {
    const base = buildBaseSpec();
    const spec = {
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "landscape",
            sizeIntent: null,
            sectionIds: ["identity"],
          },
        },
      ],
    } as unknown as CharacterSheetSpec;
    const parsed = CharacterSheetSpecSchema.parse(spec);
    const { bytes } = await renderCharacterSheetPdf({ spec: parsed });
    const { document } = await loadForm(bytes);

    const page = document.getPage(0);
    expect(page.getWidth()).toBe(792);
    expect(page.getHeight()).toBe(612);
  });

  it("renders A4 pages at 595.28x841.89", async () => {
    const base = buildBaseSpec();
    const spec = {
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "portrait",
            sizeIntent: "a4",
            sectionIds: ["identity"],
          },
        },
      ],
    } as unknown as CharacterSheetSpec;
    const parsed = CharacterSheetSpecSchema.parse(spec);
    const { bytes } = await renderCharacterSheetPdf({ spec: parsed });
    const { document } = await loadForm(bytes);

    const page = document.getPage(0);
    expect(page.getWidth()).toBeCloseTo(595.28, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
  });

  it("coerces compact size intent to US Letter", async () => {
    const base = buildBaseSpec();
    const spec = {
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "portrait",
            sizeIntent: "compact",
            sectionIds: ["identity"],
          },
        },
      ],
    } as unknown as CharacterSheetSpec;
    const parsed = CharacterSheetSpecSchema.parse(spec);
    const { bytes } = await renderCharacterSheetPdf({ spec: parsed });
    const { document } = await loadForm(bytes);

    expect(document.getPage(0).getWidth()).toBe(612);
  });

  it("renders multi-page specs in page order with per-page geometry", async () => {
    const spec = specWithMultiplePages();
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });
    const { document } = await loadForm(bytes);

    expect(document.getPageCount()).toBe(3);
    expect(document.getPage(0).getWidth()).toBe(612);
    expect(document.getPage(2).getWidth()).toBeCloseTo(595.28, 2);

    expect(
      manifest.formFields.filter(
        (entry) => entry.canonicalKey === "character.name",
      )[0]?.pageIndex,
    ).toBe(0);
    expect(
      manifest.formFields.filter(
        (entry) => entry.canonicalKey === "strength",
      )[0]?.pageIndex,
    ).toBe(1);
    expect(
      manifest.formFields.filter(
        (entry) => entry.canonicalKey === "background",
      )[0]?.pageIndex,
    ).toBe(2);
  });
});

describe("determinism", () => {
  it("renders byte-identical PDFs for the same spec across calls", async () => {
    const spec = buildBaseSpec({
      values: {
        "character.name": "Aria Stone",
        archetype: "Ranger",
        strength: 12,
        background: "First line.\nSecond line.",
      },
    });

    const first = (await renderCharacterSheetPdf({ spec })).bytes;
    const second = (await renderCharacterSheetPdf({ spec })).bytes;

    expect(first).toEqual(second);
    expect(sha256(first)).toBe(sha256(second));
  });

  it("does not mutate or reorder the input spec", async () => {
    const spec = buildBaseSpec();
    const before = JSON.stringify(spec);
    await renderCharacterSheetPdf({ spec });
    expect(JSON.stringify(spec)).toBe(before);
  });
});

describe("error taxonomy", () => {
  it("rejects structurally invalid specs with invalid_spec", async () => {
    const invalid = { ...buildBaseSpec(), mode: "storyteller" };
    try {
      await renderCharacterSheetPdf({
        spec: invalid as unknown as CharacterSheetSpec,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterSheetPdfRenderError);
      expect((error as CharacterSheetPdfRenderError).code).toBe("invalid_spec");
      return;
    }
    throw new Error("Expected render to fail with invalid_spec.");
  });

  it("rejects unsupported field types with unsupported_field_type", async () => {
    await expectRenderError(
      specWithUnsupportedFieldType(),
      "unsupported_field_type",
    );
  });

  it("rejects a wrong value type with unsupported_field_value", async () => {
    await expectRenderError(
      specWithWrongValueType(),
      "unsupported_field_value",
    );
  });

  it("rejects non-scalar calculated values with unsupported_field_value", async () => {
    const base = specWithCalculatedField();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      values: { "level.calc": { nested: true } },
    } as unknown as CharacterSheetSpec);
    await expectRenderError(spec, "unsupported_field_value");
  });

  it("rejects an unsupported glyph in the sheet title", async () => {
    const spec = buildBaseSpec({ title: "Wyrm ⚔️" });
    await expectRenderError(spec, "unsupported_glyph");
  });

  it("rejects an unsupported glyph in a field label", async () => {
    const base = buildBaseSpec();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      fields: base.fields.map((field) =>
        field.id === "archetype" ? { ...field, label: "Archetype 🧙" } : field,
      ),
    });
    await expectRenderError(spec, "unsupported_glyph");
  });

  it("rejects an unsupported glyph in a field value", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Ståle → Brak" },
    });
    await expectRenderError(spec, "unsupported_glyph");
  });

  it("rejects newlines in single-line text values", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Line one\nLine two" },
    });
    await expectRenderError(spec, "unsupported_glyph");
  });

  it("rejects duplicate AcroForm field names with duplicate_form_field", async () => {
    const base = buildBaseSpec();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "portrait",
            sizeIntent: null,
            sectionIds: ["identity", "identity"],
          },
        },
      ],
    } as unknown as CharacterSheetSpec);
    await expectRenderError(spec, "duplicate_form_field");
  });

  it("rejects page references to unknown sections with invalid_spec", async () => {
    const base = buildBaseSpec();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "portrait",
            sizeIntent: null,
            sectionIds: ["ghost"],
          },
        },
      ],
    } as unknown as CharacterSheetSpec);
    await expectRenderError(spec, "invalid_spec");
  });

  it("rejects section references to unknown fields with invalid_spec", async () => {
    const base = buildBaseSpec();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      sections: base.sections.map((section) =>
        section.id === "identity"
          ? { ...section, fieldIds: ["character.name", "missing.field"] }
          : section,
      ),
    } as unknown as CharacterSheetSpec);
    await expectRenderError(spec, "invalid_spec");
  });

  it("rejects a section that overflows the available page with layout_overflow", async () => {
    const base = buildBaseSpec({ values: {} });
    const manyFields = Array.from({ length: 40 }, (_, index) => ({
      type: "text" as const,
      id: `crowd.${index}`,
      label: `Field ${index}`,
      requiredForPlayableNpc: false,
      placement: {
        order: index,
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      },
    }));
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      pages: [
        {
          id: "page.1",
          layout: {
            orientation: "portrait",
            sizeIntent: null,
            sectionIds: ["crowd"],
          },
        },
      ],
      sections: [
        {
          id: "crowd",
          title: "Crowd",
          layout: { mode: "grid", columns: 1, order: 0, emphasis: "normal" },
          fieldIds: manyFields.map((field) => field.id),
        },
      ],
      fields: manyFields,
      values: {},
    } as unknown as CharacterSheetSpec);
    await expectRenderError(spec, "layout_overflow");
  });

  it("exposes every renderer failure mode through CharacterSheetPdfRenderError", () => {
    expect(PDF_RENDER_ERROR_CODES).toEqual([
      "invalid_spec",
      "unsupported_field_type",
      "unsupported_field_value",
      "unsupported_glyph",
      "layout_overflow",
      "duplicate_form_field",
      "pdf_generation_failed",
    ]);
  });
});

describe("text fitting", () => {
  it("accepts long values by shrinking the field font instead of failing", async () => {
    const longName = "A".repeat(200);
    const spec = specWithFieldValues({ "character.name": longName });
    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });
    expect(manifest.formFields).toHaveLength(spec.fields.length);

    const { form } = await loadForm(bytes);
    expect(form.getTextField("rpgforge.character.name").getText()).toBe(
      longName,
    );
  });

  it("does not throw when a calculated snapshot is absent (selectively blank)", async () => {
    const base = specWithCalculatedField();
    const spec = CharacterSheetSpecSchema.parse({
      ...base,
      values: {},
    } as unknown as CharacterSheetSpec);
    const { manifest } = await renderCharacterSheetPdf({ spec });
    expect(
      manifest.formFields.find((entry) => entry.canonicalKey === "level.calc")
        ?.editable,
    ).toBe(false);
  });
});
