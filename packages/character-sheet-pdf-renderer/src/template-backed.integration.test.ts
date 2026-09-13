import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  createReferenceSheetTemplateExtractor,
  extractSheetTemplate,
} from "@repo/character-sheet-template";
import {
  NPCGenerationRequestSchema,
  PCGenerationRequestSchema,
  generateTemplateBackedSheet,
} from "@repo/character-sheet-generation";
import { renderCharacterSheetPdf } from "./renderer.js";
import { PDF_FIELD_PREFIX } from "./values.js";

async function extractReferenceTemplate(source: {
  kind: "direct-sheet";
  sheetKey: string;
}) {
  const outcome = await extractSheetTemplate(
    { source },
    { extractionPort: createReferenceSheetTemplateExtractor() },
  );
  if (outcome.kind !== "ok") {
    throw new Error(`Expected ok extraction, got ${outcome.kind}.`);
  }
  return outcome.template;
}

async function generateFromReference(
  source: { kind: "direct-sheet"; sheetKey: string },
  request: Parameters<typeof generateTemplateBackedSheet>[0]["request"],
  seed: string,
) {
  const template = await extractReferenceTemplate(source);
  return generateTemplateBackedSheet({
    template,
    request,
    context: null,
    sheetId: `sheet.template.${source.sheetKey}`,
    seed,
  });
}

function loadForm(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function assertNoRasterImages(document: PDFDocument): Promise<void> {
  // Text-field appearance streams are Form XObjects (expected), but a genuine
  // RPG Forge document embeds its parchment look with vector shapes and text
  // only: embedding the reference sheet (or any other pixel content) as an
  // image would surface as an /XObject with /Subtype /Image somewhere.
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    const dict = (object as { dict?: Map<PDFName, unknown> }).dict;
    if (dict === undefined) continue;
    const isRasterImage =
      dict.get(PDFName.of("Type"))?.toString() === "/XObject" &&
      dict.get(PDFName.of("Subtype"))?.toString() === "/Image";
    expect(isRasterImage).toBe(false);
  }
}

describe("template-backed PDF integration", () => {
  it("renders a template-backed PC sheet as ownership of the compiler sections", async () => {
    const outcome = await generateFromReference(
      { kind: "direct-sheet", sheetKey: "one-shot-pc" },
      PCGenerationRequestSchema.parse({
        mode: "pc",
        mechanicalFields: [
          { label: "Vigor", initialValue: 7 },
          { label: "Prowess", initialValue: null },
        ],
        identityTraits: [
          { label: "Background", value: "Sailor turned cartographer" },
        ],
      }),
      "seed-morningstar",
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;

    const { spec, templateConflicts, overlayConflicts } = outcome;
    expect(templateConflicts).toHaveLength(0);
    expect(overlayConflicts).toHaveLength(0);

    // The template-declared sections become the compiled sheet's sections.
    expect(spec.sections.map((section) => section.title)).toEqual([
      "Identity",
      "Attributes",
    ]);
    // The template's field kinds are propagated into the compiled spec.
    const fields = new Map(spec.fields.map((field) => [field.id, field]));
    expect(fields.get("character_name")?.type).toBe("text");
    expect(fields.get("background")?.type).toBe("textarea");
    expect(fields.get("vigor")?.type).toBe("number");
    expect(fields.get("prowess")?.type).toBe("number");

    // Explicit GUI values win within the template bounds; blanks stay blank.
    expect(spec.values.background).toBe("Sailor turned cartographer");
    expect(spec.values.vigor).toBe(7);
    expect(spec.values.prowess).toBeUndefined();

    // A genuine GUI-only sheet reserves the provenance slots without filling
    // them and never embeds rulebook or source-sheet provenance.
    expect(spec.rulesContextId).toBeNull();
    expect(Object.keys(spec.sourceMap)).toHaveLength(0);
    expect(spec.fields.some((field) => field.type === "image")).toBe(false);

    const { bytes } = await renderCharacterSheetPdf({ spec });
    const document = await loadForm(bytes);
    const form = document.getForm();
    const parsedNames = form.getFields().map((field) => field.getName());

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(document.getTitle()).toBe("Character Sheet");
    expect(document.getProducer()).toBe("RPG Forge");
    expect(document.getCreator()).toBe("RPG Forge Character Sheet Renderer");
    expect(document.getPageCount()).toBe(spec.pages.length);
    expect(parsedNames).toEqual(
      expect.arrayContaining([
        `${PDF_FIELD_PREFIX}.character_name`,
        `${PDF_FIELD_PREFIX}.background`,
        `${PDF_FIELD_PREFIX}.vigor`,
        `${PDF_FIELD_PREFIX}.prowess`,
      ]),
    );
    expect(form.getTextField(`${PDF_FIELD_PREFIX}.background`).getText()).toBe(
      "Sailor turned cartographer",
    );
    expect(form.getTextField(`${PDF_FIELD_PREFIX}.vigor`).getText()).toBe("7");
    await assertNoRasterImages(document);
  });

  it("renders a template-backed NPC sheet with seeded in-bounds values and a merged GUI-only field", async () => {
    // "One-Shot Tiebreaker" is not on the reference sheet; the GUI request
    // supplies its bounds directly, and the template bounds win when they
    // exist. The fixed 1..1 range proves the min===max deterministic path.
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "enemy",
      threat: "ordinary",
      mechanicalFields: [
        { label: "Guard Rating", min: 1, max: 20 },
        { label: "Composure", min: 1, max: 20 },
        { label: "One-Shot Tiebreaker", min: 1, max: 1 },
      ],
    });

    const outcome = await generateFromReference(
      { kind: "direct-sheet", sheetKey: "one-shot-npc" },
      request,
      "seed-anvil",
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;

    const { spec, overlayConflicts } = outcome;
    expect(spec.mode).toBe("npc");
    expect(overlayConflicts).toHaveLength(0);
    expect(spec.sections.map((section) => section.title)).toEqual([
      "Identity",
      "Attributes",
    ]);

    const fields = new Map(spec.fields.map((field) => [field.id, field]));
    expect(fields.get("character_name")?.type).toBe("text");
    expect(fields.get("role")?.type).toBe("text");
    expect(fields.get("guard_rating")?.type).toBe("number");
    expect(fields.get("composure")?.type).toBe("number");

    // "One-Shot Tiebreaker" is not on the reference sheet; hyphens are stripped
    // from canonical keys, so the field id is resolved from the merged spec.
    const tiebreakerFields = spec.fields.filter((field) =>
      field.id.startsWith("oneshot_tiebreaker"),
    );
    expect(tiebreakerFields).toHaveLength(1);
    const tiebreakerField = tiebreakerFields[0]!;
    const tiebreakerId = tiebreakerField.id;
    expect(tiebreakerField.type).toBe("number");

    // The tiebreaker is a GUI-only field on the merged sheet with a fixed value.
    expect(spec.values[tiebreakerId]).toBe(1);

    const guardRating = spec.values.guard_rating;
    const composure = spec.values.composure;
    expect(guardRating).toBeTypeOf("number");
    expect(composure).toBeTypeOf("number");
    if (typeof guardRating !== "number" || typeof composure !== "number") {
      throw new Error("NPC mechanical values must be numbers.");
    }
    expect(Number.isInteger(guardRating)).toBe(true);
    expect(guardRating).toBeGreaterThanOrEqual(1);
    expect(guardRating).toBeLessThanOrEqual(20);
    expect(composure).toBeGreaterThanOrEqual(1);
    expect(composure).toBeLessThanOrEqual(20);

    expect(spec.rulesContextId).toBeNull();
    expect(Object.keys(spec.sourceMap)).toHaveLength(0);

    const { bytes } = await renderCharacterSheetPdf({ spec });
    const document = await loadForm(bytes);
    const form = document.getForm();

    expect(document.getTitle()).toBe("NPC Sheet");
    expect(document.getPageCount()).toBe(spec.pages.length);
    expect(
      Number(form.getTextField(`${PDF_FIELD_PREFIX}.guard_rating`).getText()),
    ).toBe(guardRating);
    expect(
      form.getTextField(`${PDF_FIELD_PREFIX}.${tiebreakerId}`).getText(),
    ).toBe("1");
    await assertNoRasterImages(document);
  });

  it("reproduces the same seeded values across repeated template-backed generation", async () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "enemy",
      threat: "ordinary",
      mechanicalFields: [
        { label: "Guard Rating", min: 1, max: 20 },
        { label: "Composure", min: 1, max: 20 },
      ],
    });

    const first = await generateFromReference(
      { kind: "direct-sheet", sheetKey: "one-shot-npc" },
      request,
      "seed-repro",
    );
    const second = await generateFromReference(
      { kind: "direct-sheet", sheetKey: "one-shot-npc" },
      request,
      "seed-repro",
    );
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(first.spec.values).toEqual(second.spec.values);
    expect(first.spec.values.guard_rating).toBe(
      second.spec.values.guard_rating,
    );
  });

  it("varies seeded NPC values across seeds while staying inside template bounds", async () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "enemy",
      threat: "ordinary",
      mechanicalFields: [
        { label: "Guard Rating", min: 1, max: 20 },
        { label: "Composure", min: 1, max: 20 },
      ],
    });

    const guardRatings = new Set<number>();
    for (const seed of [
      "variance-1",
      "variance-2",
      "variance-3",
      "variance-4",
      "variance-5",
      "variance-6",
      "variance-7",
      "variance-8",
    ]) {
      const outcome = await generateFromReference(
        { kind: "direct-sheet", sheetKey: "one-shot-npc" },
        request,
        seed,
      );
      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") continue;
      const value = outcome.spec.values.guard_rating;
      expect(value).toBeTypeOf("number");
      if (typeof value !== "number") continue;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
      guardRatings.add(value);
    }

    // Eight independent draws over a 20-wide range: the chance all coincide
    // is negligible, so this proves the seeded population is not pinned to a
    // constant (and is not Math.random, which would be non-deterministic).
    expect(guardRatings.size).toBeGreaterThan(1);
  });
});
