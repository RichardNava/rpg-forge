import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  PCGenerationRequestSchema,
  generateCharacterSheetSpec,
  generateNormalizedSheet,
  type Level3NamePort,
  type RulebookFieldDerivationPort,
} from "@repo/character-sheet-generation";
import { renderCharacterSheetPdf } from "./renderer.js";
import { PDF_FIELD_PREFIX } from "./values.js";

class FixedNamePort implements Level3NamePort {
  async generateName(input: {
    mode: "pc" | "npc";
    system: string;
    user: string;
  }): Promise<string> {
    return "Aria Stone";
  }
}

function neverCalledDerivationPort(): {
  port: RulebookFieldDerivationPort;
  calls: () => number;
} {
  let calls = 0;
  return {
    port: {
      async derive() {
        calls += 1;
        throw new Error("GUI-only generation must never call derivation.");
      },
    },
    calls: () => calls,
  };
}

async function buildGuiOnlySpec() {
  const { port: derivationPort, calls } = neverCalledDerivationPort();

  const normalized = await generateNormalizedSheet(
    {
      request: PCGenerationRequestSchema.parse({
        mode: "pc",
        mechanicalFields: [
          { label: "Strength", initialValue: 12 },
          { label: "Perception", initialValue: null },
        ],
        identityTraits: [{ label: "Homeland", value: "Riverside" }],
      }),
      context: null,
    },
    { derivationPort },
  );
  if (normalized.kind !== "ok") {
    throw new Error(`Expected ok outcome, got ${normalized.kind}.`);
  }

  const spec = await generateCharacterSheetSpec({
    definition: normalized.result.definition,
    context: null,
    namePort: new FixedNamePort(),
    sheetId: "sheet.gui.integration.0001",
  });

  return { spec, derivationCalls: calls() };
}

describe("GUI-only PDF integration", () => {
  it("renders a genuine GUI-only spec (rulesContextId null) to a loadable PDF with fields", async () => {
    const { spec, derivationCalls } = await buildGuiOnlySpec();

    expect(spec.rulesContextId).toBeNull();
    expect(spec.metadata.id).toBe("sheet.gui.integration.0001");
    expect(Object.keys(spec.sourceMap)).toHaveLength(0);
    expect(derivationCalls).toBe(0);

    const { bytes } = await renderCharacterSheetPdf({ spec });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
    });
    const form = document.getForm();
    const parsedNames = form.getFields().map((field) => field.getName());

    expect(document.getPageCount()).toBe(spec.pages.length);
    expect(parsedNames).toContain(`${PDF_FIELD_PREFIX}.character_name`);
    expect(parsedNames).toContain(`${PDF_FIELD_PREFIX}.strength`);
    expect(
      form.getTextField(`${PDF_FIELD_PREFIX}.character_name`).getText(),
    ).toBe("Aria Stone");
    expect(form.getTextField(`${PDF_FIELD_PREFIX}.strength`).getText()).toBe(
      "12",
    );
    // Blank PC values stay blank: the Perception control exists but carries no
    // text at all (undefined), matching the renderer's no-placeholder contract.
    expect(form.getTextField(`${PDF_FIELD_PREFIX}.perception`).getText()).toBe(
      undefined,
    );
  });
});
