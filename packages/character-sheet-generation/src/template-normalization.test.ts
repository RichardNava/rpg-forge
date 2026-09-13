import { describe, expect, it } from "vitest";
import type { CharacterSheetTemplate } from "@repo/character-sheet-template";
import {
  normalizeTemplateFields,
  overlayTemplateWithGui,
} from "./template-normalization.js";
import type { CharacterSheetAuthoringMode } from "./authoring.js";
import type { SourceResolvedField } from "./source-resolution.js";

const pcTemplate: CharacterSheetTemplate = {
  schemaVersion: 1,
  mode: "pc",
  sections: [{ key: "identity", title: "Identity" }],
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
      sectionKey: "identity",
      numericBounds: { min: 1, max: 10 },
    },
    {
      label: "Wits",
      category: "mechanical",
      kind: "number",
      sectionKey: "identity",
    },
  ],
};

const npcTemplate: CharacterSheetTemplate = {
  schemaVersion: 1,
  mode: "npc",
  sections: [
    { key: "identity", title: "Identity" },
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
      label: "Guard Rating",
      category: "mechanical",
      kind: "number",
      sectionKey: "attributes",
      numericBounds: { min: 3, max: 18 },
    },
  ],
};

describe("normalizeTemplateFields", () => {
  it("maps a PC template onto SourceResolvedFields with sheet-template origin", () => {
    const result = normalizeTemplateFields(pcTemplate, "pc");
    expect(result.conflicts).toHaveLength(0);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]).toMatchObject({
      canonicalKey: "character_name",
      label: "Character Name",
      category: "identity",
      provenance: { origins: ["sheet-template"] },
    });
    expect("explicitValue" in result.fields[0]!).toBe(false);
    expect(result.fields[1]).toMatchObject({
      canonicalKey: "vigor",
      label: "Vigor",
      category: "mechanical",
      explicitValue: null,
      permittedValueRange: { min: 1, max: 10 },
      provenance: { origins: ["sheet-template"] },
    });
    expect(result.fields[2]).toMatchObject({
      canonicalKey: "wits",
      label: "Wits",
      category: "mechanical",
      explicitValue: null,
      provenance: { origins: ["sheet-template"] },
    });
    expect("permittedValueRange" in result.fields[2]!).toBe(false);
  });

  it("maps an NPC template without explicit values and with bounds", () => {
    const result = normalizeTemplateFields(npcTemplate, "npc");
    expect(result.conflicts).toHaveLength(0);
    const guardField = result.fields.find(
      (f) => f.canonicalKey === "guard_rating",
    );
    expect(guardField).toBeDefined();
    expect(guardField!.explicitValue).toBeUndefined();
    expect(guardField!.permittedValueRange).toEqual({ min: 3, max: 18 });
  });

  it("flags a mode mismatch as a visible conflict", () => {
    const result = normalizeTemplateFields(pcTemplate, "npc");
    expect(result.fields).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.code).toBe("TEMPLATE_MODE_MISMATCH");
  });

  it("detects duplicate canonical keys and drops the second field", () => {
    const dupesTemplate: CharacterSheetTemplate = {
      schemaVersion: 1,
      mode: "pc",
      sections: [{ key: "attributes", title: "Attributes" }],
      fields: [
        {
          label: "Vigor",
          category: "mechanical",
          kind: "number",
          sectionKey: "attributes",
          numericBounds: { min: 1, max: 10 },
        },
        {
          label: "vigor",
          category: "mechanical",
          kind: "number",
          sectionKey: "attributes",
          numericBounds: { min: 1, max: 10 },
        },
        {
          label: "Wits",
          category: "mechanical",
          kind: "number",
          sectionKey: "attributes",
        },
      ],
    };
    const result = normalizeTemplateFields(dupesTemplate, "pc");
    expect(result.fields).toHaveLength(2);
    expect(result.fields.map((f) => f.canonicalKey)).toEqual(["vigor", "wits"]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.code).toBe("DUPLICATE_TEMPLATE_FIELD_LABEL");
  });
});

describe("overlayTemplateWithGui", () => {
  const templateFields: SourceResolvedField[] = normalizeTemplateFields(
    pcTemplate,
    "pc",
  ).fields;
  const vig = templateFields.find((f) => f.canonicalKey === "vigor")!;
  const wits = templateFields.find((f) => f.canonicalKey === "wits")!;
  const name = templateFields.find((f) => f.canonicalKey === "character_name")!;

  it("overlays a GUI mechanical value within bounds", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Vigor",
      category: "mechanical",
      explicitValue: 7,
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const merged = result.fields.find((f) => f.canonicalKey === "vigor")!;
    expect(merged.explicitValue).toBe(7);
    expect(merged.permittedValueRange).toEqual({ min: 1, max: 10 });
    expect(merged.provenance.origins).toEqual(["sheet-template", "gui"]);
    expect(result.conflicts).toHaveLength(0);
  });

  it("rejects an out-of-range GUI value and keeps template blank", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Vigor",
      category: "mechanical",
      explicitValue: 25,
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const merged = result.fields.find((f) => f.canonicalKey === "vigor")!;
    expect(merged.explicitValue).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.code).toBe("INVALID_CONSTRAINT_VALUE");
  });

  it("keeps template bounds when GUI supplies contradictory bounds", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Vigor",
      category: "mechanical",
      permittedValueRange: { min: 20, max: 30 },
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const merged = result.fields.find((f) => f.canonicalKey === "vigor")!;
    expect(merged.permittedValueRange).toEqual({ min: 1, max: 10 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.code).toBe("TEMPLATE_BOUND_DISAGREEMENT");
  });

  it("overlays GUI bounds when template has no bounds", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "wits",
      label: "Wits",
      category: "mechanical",
      permittedValueRange: { min: 1, max: 15 },
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const merged = result.fields.find((f) => f.canonicalKey === "wits")!;
    expect(merged.permittedValueRange).toEqual({ min: 1, max: 15 });
    expect(result.conflicts).toHaveLength(0);
  });

  it("appends a GUI-only field not present in the template", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "nickname",
      label: "Nickname",
      category: "identity",
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    expect(
      result.fields.find((f) => f.canonicalKey === "nickname"),
    ).toBeDefined();
    expect(result.fields).toHaveLength(4);
    expect(result.conflicts).toHaveLength(0);
  });

  it("reports TEMPLATE_CATEGORY_DISAGREEMENT when same key appears in different category", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Vigor",
      category: "identity",
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const identities = result.fields.filter((f) => f.category === "identity");
    expect(identities.find((f) => f.canonicalKey === "vigor")).toBeDefined();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.code).toBe("TEMPLATE_CATEGORY_DISAGREEMENT");
  });

  it("preserves the template label when GUI adds a value", () => {
    const guiField: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Vigour",
      category: "mechanical",
      explicitValue: 5,
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [guiField],
    });
    const merged = result.fields.find((f) => f.canonicalKey === "vigor")!;
    expect(merged.label).toBe("Vigor");
  });

  it("handles multiple GUI fields targeting the same template identity consecutively", () => {
    const first: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "Hit Points",
      category: "mechanical",
      explicitValue: 4,
      provenance: { origins: ["gui"] },
    };
    const second: SourceResolvedField = {
      canonicalKey: "vigor",
      label: "hit_points",
      category: "mechanical",
      explicitValue: 6,
      provenance: { origins: ["gui"] },
    };
    const result = overlayTemplateWithGui({
      templateFields,
      guiFields: [first, second],
    });
    const vig = result.fields.filter((f) => f.canonicalKey === "vigor");
    expect(vig).toHaveLength(1);
    expect(vig[0]!.explicitValue).toBe(6);
  });
});
