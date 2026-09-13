import { describe, expect, it } from "vitest";
import {
  CharacterSheetTemplateSchema,
  CharacterSheetTemplateSourceSchema,
  MAX_TEMPLATE_FIELDS,
  MAX_TEMPLATE_SECTIONS,
} from "./index.js";

const validTemplate = {
  schemaVersion: 1,
  mode: "pc",
  sections: [
    { key: "identity", title: "Identity", purpose: "Personal traits." },
    { key: "attributes", title: "Attributes" },
  ],
  fields: [
    {
      label: "Character Name",
      category: "identity",
      kind: "text",
      sectionKey: "identity",
    },
    {
      label: "Vigor",
      category: "mechanical",
      kind: "number",
      sectionKey: "attributes",
      numericBounds: { min: 1, max: 10 },
    },
  ],
} as const;

describe("CharacterSheetTemplateSchema", () => {
  it("accepts a valid template", () => {
    expect(CharacterSheetTemplateSchema.parse(validTemplate)).toMatchObject({
      schemaVersion: 1,
      mode: "pc",
    });
  });

  it("rejects a template with an unsupported schemaVersion", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        schemaVersion: 2,
      }),
    ).toThrow();
  });

  it("rejects duplicate section keys", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        sections: [
          { key: "identity", title: "Identity" },
          { key: "identity", title: "Attributes" },
        ],
      }),
    ).toThrow(/repeats/);
  });

  it("rejects duplicate field labels", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        fields: [
          { label: "Vigor", category: "mechanical", kind: "number" },
          { label: "Vigor", category: "mechanical", kind: "number" },
        ],
      }),
    ).toThrow(/repeats/);
  });

  it("rejects fields referencing an unknown section", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        fields: [
          {
            label: "Vigor",
            category: "mechanical",
            kind: "number",
            sectionKey: "nope",
          },
        ],
      }),
    ).toThrow(/unknown section/);
  });

  it("rejects identity fields carrying numeric bounds", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        fields: [
          {
            label: "Background",
            category: "identity",
            kind: "text",
            numericBounds: { min: 1, max: 5 },
          },
        ],
      }),
    ).toThrow(/must not carry numeric bounds/);
  });

  it("rejects reversed numeric bounds", () => {
    expect(() =>
      CharacterSheetTemplateSchema.parse({
        ...validTemplate,
        fields: [
          {
            label: "Vigor",
            category: "mechanical",
            kind: "number",
            numericBounds: { min: 10, max: 1 },
          },
        ],
      }),
    ).toThrow(/greater than or equal to min/);
  });

  it("caps the section and field counts", () => {
    const overSectionLimit = {
      ...validTemplate,
      sections: Array.from({ length: MAX_TEMPLATE_SECTIONS + 1 }, (_, i) => ({
        key: `section_${i}`,
        title: `Section ${i}`,
      })),
    };
    expect(() =>
      CharacterSheetTemplateSchema.parse(overSectionLimit),
    ).toThrow();

    const overFieldLimit = {
      ...validTemplate,
      sections: [{ key: "attributes", title: "Attributes" }],
      fields: Array.from({ length: MAX_TEMPLATE_FIELDS + 1 }, (_, i) => ({
        label: `Field ${i}`,
        category: "mechanical" as const,
        kind: "number" as const,
      })),
    };
    expect(() => CharacterSheetTemplateSchema.parse(overFieldLimit)).toThrow();
  });
});

describe("CharacterSheetTemplateSourceSchema", () => {
  it("accepts a direct-sheet source", () => {
    const parsed = CharacterSheetTemplateSourceSchema.parse({
      kind: "direct-sheet",
      sheetKey: "one-shot-pc",
      locale: "en",
    });
    expect(parsed.kind).toBe("direct-sheet");
  });

  it("accepts a rulebook-contained source with a page range", () => {
    const parsed = CharacterSheetTemplateSourceSchema.parse({
      kind: "rulebook-contained-sheet",
      rulebookKey: "intro-rulebook",
      pageStart: 12,
      pageEnd: 14,
    });
    expect(parsed.kind).toBe("rulebook-contained-sheet");
  });

  it("rejects a reversed page range", () => {
    expect(() =>
      CharacterSheetTemplateSourceSchema.parse({
        kind: "rulebook-contained-sheet",
        rulebookKey: "intro-rulebook",
        pageStart: 20,
        pageEnd: 10,
      }),
    ).toThrow(/greater than or equal to its start/);
  });

  it("rejects a blank source key", () => {
    expect(() =>
      CharacterSheetTemplateSourceSchema.parse({
        kind: "direct-sheet",
        sheetKey: "  ",
      }),
    ).toThrow();
  });
});
