import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildBaseSpec } from "./fixtures.js";
import { renderCharacterSheetPdf } from "./renderer.js";
import { CharacterSheetPdfRenderError } from "./errors.js";

describe("character-sheet PDF renderer in workerd", () => {
  it("renders a valid AcroForm PDF inside the workerd runtime", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Workerd Hero", strength: 5 },
    });

    const { bytes, manifest } = await renderCharacterSheetPdf({ spec });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(manifest.pageCount).toBe(1);

    const document = await PDFDocument.load(bytes);
    const form = document.getForm();

    expect(document.getPageCount()).toBe(1);
    expect(form.getTextField("rpgforge.character.name").getText()).toBe(
      "Workerd Hero",
    );
    expect(form.getTextField("rpgforge.strength").getText()).toBe("5");
    expect(form.getTextField("rpgforge.background").isMultiline()).toBe(true);
  });

  it("keeps determinism guarantees in workerd too", async () => {
    const spec = buildBaseSpec({ values: { "character.name": "Dual Render" } });
    const first = (await renderCharacterSheetPdf({ spec })).bytes;
    const second = (await renderCharacterSheetPdf({ spec })).bytes;
    expect(first).toEqual(second);
  });

  it("surfaces the renderer error taxonomy in workerd", async () => {
    const spec = buildBaseSpec({
      values: { "character.name": "Bad ⚠️ value" },
    });
    try {
      await renderCharacterSheetPdf({ spec });
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterSheetPdfRenderError);
      expect((error as CharacterSheetPdfRenderError).code).toBe(
        "unsupported_glyph",
      );
      return;
    }
    throw new Error("Expected render to fail with unsupported_glyph.");
  });
});
