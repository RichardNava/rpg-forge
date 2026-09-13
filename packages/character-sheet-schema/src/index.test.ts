import { RulesContextSchema } from "@repo/rules-context";
import { describe, expect, it } from "vitest";

import {
  CharacterSheetSpecSchema,
  FormulaSchema,
  getCharacterSheetSpecJsonSchema,
  validateCharacterSheetSpecDomain,
} from "./index";

function createRulesContext() {
  return RulesContextSchema.parse({
    schemaVersion: "1",
    analysisId: "analysis-1",
    sources: [
      {
        id: "preset-1",
        type: "preset",
        systemKey: "generic-fantasy",
        editionKey: "core",
        displayName: "Generic Fantasy Core",
      },
    ],
    authorityOrder: ["preset-1"],
    characterIntent: null,
    ruleOverrides: [],
    normalizedRules: [
      {
        id: "rule-endurance",
        category: "character",
        key: "endurance",
        summary: "Endurance contributes to maximum stamina.",
        citations: [
          {
            sourceId: "preset-1",
            pageStart: null,
            pageEnd: null,
            section: "Character creation",
            chunkId: "preset-character-1",
          },
        ],
        confidence: 1,
      },
    ],
    conflicts: [],
    status: "ready",
  });
}

function createPlayerSheet() {
  return CharacterSheetSpecSchema.parse({
    schemaVersion: "1",
    mode: "player",
    metadata: {
      id: "sheet-1",
      title: "Explorer Sheet",
      description: null,
      locale: "en",
    },
    rulesContextId: "analysis-1",
    pages: [
      {
        id: "page-1",
        layout: {
          orientation: "portrait",
          sizeIntent: "letter",
          sectionIds: ["identity-section"],
        },
      },
    ],
    sections: [
      {
        id: "identity-section",
        title: "Identity",
        layout: {
          mode: "grid",
          columns: 2,
          order: 0,
          emphasis: "primary",
        },
        fieldIds: ["name-field"],
      },
    ],
    fields: [
      {
        id: "name-field",
        type: "text",
        label: "Name",
        requiredForPlayableNpc: false,
        placement: {
          order: 0,
          columnStart: 1,
          columnSpan: 2,
          rowSpan: 1,
          breakBefore: false,
        },
        maxLength: 80,
      },
    ],
    values: {},
    theme: {
      style: "classic",
      typography: "serif",
      density: "standard",
      borderStyle: "line",
      decorationIntensity: "subtle",
      accentColor: "#2A5D3B",
      backgroundIntent: "parchment",
    },
    sourceMap: {},
  });
}

function issueCodes(
  value: ReturnType<typeof validateCharacterSheetSpecDomain>,
) {
  return value.issues.map((issue) => issue.code);
}

function createNestedFormula(depth: number): unknown {
  let formula: unknown = { op: "literal", value: 1 };
  for (let index = 0; index < depth; index += 1) {
    formula = {
      op: "add",
      left: formula,
      right: { op: "literal", value: 1 },
    };
  }
  return formula;
}

function createLargeProvenanceFixture() {
  const ruleIds = Array.from({ length: 64 }, (_, index) => `rule-${index}`);
  const fieldIds = Array.from({ length: 256 }, (_, index) => `field-${index}`);
  const sectionIds = Array.from(
    { length: 4 },
    (_, index) => `section-${index}`,
  );
  const context = RulesContextSchema.parse({
    schemaVersion: "1",
    analysisId: "analysis-large",
    sources: [
      {
        id: "preset-1",
        type: "preset",
        systemKey: "generic-fantasy",
        editionKey: "core",
        displayName: "Generic Fantasy Core",
      },
    ],
    authorityOrder: ["preset-1"],
    characterIntent: null,
    ruleOverrides: [],
    normalizedRules: ruleIds.map((id, ruleIndex) => ({
      id,
      category: "character",
      key: id,
      summary: `Synthetic rule ${ruleIndex}.`,
      citations: Array.from({ length: 64 }, (_, citationIndex) => ({
        sourceId: "preset-1",
        pageStart: null,
        pageEnd: null,
        section: null,
        chunkId: `chunk-${ruleIndex}-${citationIndex}`,
      })),
      confidence: 1,
    })),
    conflicts: [],
    status: "ready",
  });
  const sharedCitations = context.normalizedRules[63]!.citations;
  const sheet = CharacterSheetSpecSchema.parse({
    schemaVersion: "1",
    mode: "player",
    metadata: {
      id: "sheet-large",
      title: "Large Provenance Sheet",
      description: null,
      locale: "en",
    },
    rulesContextId: context.analysisId,
    pages: [
      {
        id: "page-1",
        layout: {
          orientation: "portrait",
          sizeIntent: "letter",
          sectionIds,
        },
      },
    ],
    sections: sectionIds.map((id, sectionIndex) => ({
      id,
      title: `Section ${sectionIndex}`,
      layout: {
        mode: "flow",
        columns: 1,
        order: sectionIndex,
        emphasis: null,
      },
      fieldIds: fieldIds.slice(sectionIndex * 64, (sectionIndex + 1) * 64),
    })),
    fields: fieldIds.map((id, fieldIndex) => ({
      id,
      type: "text",
      label: `Field ${fieldIndex}`,
      requiredForPlayableNpc: false,
      placement: {
        order: fieldIndex,
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      },
    })),
    values: {},
    theme: {
      style: "utility",
      typography: "sans-serif",
      density: "compact",
      borderStyle: "line",
      decorationIntensity: "none",
      accentColor: "#2A5D3B",
      backgroundIntent: "none",
    },
    sourceMap: Object.fromEntries(
      fieldIds.map((fieldId) => [
        fieldId,
        { ruleIds, citations: sharedCitations },
      ]),
    ),
  });

  return { context, sheet };
}

describe("CharacterSheetSpecSchema", () => {
  it("allows a player sheet without provenance to have empty values without RulesContext", () => {
    const sheet = createPlayerSheet();

    expect(validateCharacterSheetSpecDomain(sheet)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("accepts a prefilled playable NPC sheet", () => {
    const sheet = createPlayerSheet();
    const npcSheet = CharacterSheetSpecSchema.parse({
      ...sheet,
      mode: "npc",
      fields: [
        {
          ...sheet.fields[0]!,
          requiredForPlayableNpc: true,
        },
      ],
      values: { "name-field": "Mira Thorn" },
    });

    expect(validateCharacterSheetSpecDomain(npcSheet)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("supports every bounded field variant", () => {
    const sheet = createPlayerSheet();
    const fields = [
      {
        id: "text-field",
        type: "text",
        label: "Text",
        requiredForPlayableNpc: false,
        placement: {
          order: 0,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        id: "number-current",
        type: "number",
        label: "Current",
        requiredForPlayableNpc: false,
        placement: {
          order: 1,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        min: 0,
        max: 20,
        step: 1,
      },
      {
        id: "number-max",
        type: "number",
        label: "Maximum",
        requiredForPlayableNpc: false,
        placement: {
          order: 2,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        id: "textarea-field",
        type: "textarea",
        label: "Notes",
        requiredForPlayableNpc: false,
        placement: {
          order: 3,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        rows: 4,
      },
      {
        id: "checkbox-field",
        type: "checkbox",
        label: "Ready",
        requiredForPlayableNpc: false,
        placement: {
          order: 4,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        id: "radio-field",
        type: "radio",
        label: "Stance",
        requiredForPlayableNpc: false,
        placement: {
          order: 5,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        options: [{ value: "steady", label: "Steady" }],
      },
      {
        id: "select-field",
        type: "select",
        label: "Origin",
        requiredForPlayableNpc: false,
        placement: {
          order: 6,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        options: [{ value: "river", label: "River" }],
      },
      {
        id: "multiselect-field",
        type: "multiselect",
        label: "Skills",
        requiredForPlayableNpc: false,
        placement: {
          order: 7,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        options: [{ value: "tracking", label: "Tracking" }],
      },
      {
        id: "rating-field",
        type: "rating",
        label: "Renown",
        requiredForPlayableNpc: false,
        placement: {
          order: 8,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        scale: { min: 0, max: 5, step: 1 },
      },
      {
        id: "resource-field",
        type: "resource",
        label: "Stamina",
        requiredForPlayableNpc: false,
        placement: {
          order: 9,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        currentFieldId: "number-current",
        maxFieldId: "number-max",
        displayMode: "current-max",
      },
      {
        id: "list-field",
        type: "list",
        label: "Gear",
        requiredForPlayableNpc: false,
        placement: {
          order: 10,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        itemLabel: "Item",
      },
      {
        id: "table-field",
        type: "table",
        label: "Contacts",
        requiredForPlayableNpc: false,
        placement: {
          order: 11,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        columns: [{ id: "contact-name", label: "Name", valueType: "text" }],
      },
      {
        id: "calculated-field",
        type: "calculated",
        label: "Stamina total",
        requiredForPlayableNpc: false,
        placement: {
          order: 12,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        formula: {
          op: "add",
          left: { op: "field", fieldId: "number-current" },
          right: { op: "literal", value: 2 },
        },
      },
      {
        id: "image-field",
        type: "image",
        label: "Portrait",
        requiredForPlayableNpc: false,
        placement: {
          order: 13,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
        slot: { aspectRatio: "portrait", maxColumnSpan: 1, altText: null },
      },
    ];
    const allFieldsSheet = CharacterSheetSpecSchema.parse({
      ...sheet,
      sections: [
        {
          ...sheet.sections[0]!,
          fieldIds: fields.map((field) => field.id),
        },
      ],
      fields,
    });

    expect(validateCharacterSheetSpecDomain(allFieldsSheet)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("reports duplicate page, section, and field IDs", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain({
      ...sheet,
      pages: [...sheet.pages, sheet.pages[0]!],
      sections: [...sheet.sections, sheet.sections[0]!],
      fields: [...sheet.fields, sheet.fields[0]!],
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_PAGE_ID",
        "DUPLICATE_SECTION_ID",
        "DUPLICATE_FIELD_ID",
      ]),
    );
  });

  it("reports unknown page-to-section and section-to-field references", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain({
      ...sheet,
      pages: [
        {
          ...sheet.pages[0]!,
          layout: {
            ...sheet.pages[0]!.layout,
            sectionIds: ["missing-section"],
          },
        },
      ],
      sections: [{ ...sheet.sections[0]!, fieldIds: ["missing-field"] }],
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_SECTION_REFERENCE",
        "UNKNOWN_FIELD_REFERENCE",
      ]),
    );
  });

  it("requires declared playable NPC fields to have values", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain({
      ...sheet,
      mode: "npc",
      fields: [{ ...sheet.fields[0]!, requiredForPlayableNpc: true }],
    });

    expect(issueCodes(result)).toContain("MISSING_PLAYABLE_NPC_VALUE");
  });

  it("accepts a calculated formula referencing an existing field", () => {
    const sheet = createPlayerSheet();
    const calculatedSheet = CharacterSheetSpecSchema.parse({
      ...sheet,
      sections: [
        { ...sheet.sections[0]!, fieldIds: ["name-field", "total-field"] },
      ],
      fields: [
        ...sheet.fields,
        {
          id: "total-field",
          type: "calculated",
          label: "Total",
          requiredForPlayableNpc: false,
          placement: {
            order: 1,
            columnStart: 1,
            columnSpan: 2,
            rowSpan: 1,
            breakBefore: false,
          },
          formula: {
            op: "conditional",
            condition: {
              op: "eq",
              left: { op: "literal", value: 1 },
              right: { op: "literal", value: 1 },
            },
            whenTrue: { op: "literal", value: 2 },
            whenFalse: { op: "literal", value: 0 },
          },
        },
      ],
    });

    expect(validateCharacterSheetSpecDomain(calculatedSheet)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("reports unknown formula field references and formula cycles", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain(
      CharacterSheetSpecSchema.parse({
        ...sheet,
        sections: [{ ...sheet.sections[0]!, fieldIds: ["a-field", "b-field"] }],
        fields: [
          {
            id: "a-field",
            type: "calculated",
            label: "A",
            requiredForPlayableNpc: false,
            placement: {
              order: 0,
              columnStart: 1,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
            formula: { op: "field", fieldId: "b-field" },
          },
          {
            id: "b-field",
            type: "calculated",
            label: "B",
            requiredForPlayableNpc: false,
            placement: {
              order: 1,
              columnStart: 1,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
            formula: {
              op: "add",
              left: { op: "field", fieldId: "a-field" },
              right: { op: "field", fieldId: "missing-field" },
            },
          },
        ],
      }),
    );

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining(["UNKNOWN_FORMULA_FIELD", "FORMULA_CYCLE"]),
    );
  });

  it("reports a forward reference to a calculated field in a later section", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain(
      CharacterSheetSpecSchema.parse({
        ...sheet,
        pages: [
          {
            id: "page-1",
            layout: {
              orientation: "portrait",
              sizeIntent: "letter",
              sectionIds: [
                "identity-section",
                "derived-section",
                "later-section",
              ],
            },
          },
        ],
        sections: [
          { ...sheet.sections[0]!, fieldIds: ["name-field"] },
          {
            id: "derived-section",
            title: "Derived",
            layout: {
              mode: "grid",
              columns: 2,
              order: 1,
              emphasis: "secondary",
            },
            fieldIds: ["a-field"],
          },
          {
            id: "later-section",
            title: "Later",
            layout: {
              mode: "grid",
              columns: 2,
              order: 2,
              emphasis: null,
            },
            fieldIds: ["b-field"],
          },
        ],
        fields: [
          ...sheet.fields,
          {
            id: "a-field",
            type: "calculated",
            label: "A",
            requiredForPlayableNpc: false,
            placement: {
              order: 0,
              columnStart: 1,
              columnSpan: 2,
              rowSpan: 1,
              breakBefore: false,
            },
            formula: { op: "field", fieldId: "b-field" },
          },
          {
            id: "b-field",
            type: "calculated",
            label: "B",
            requiredForPlayableNpc: false,
            placement: {
              order: 1,
              columnStart: 1,
              columnSpan: 2,
              rowSpan: 1,
              breakBefore: false,
            },
            formula: { op: "literal", value: 1 },
          },
        ],
      }),
    );

    expect(issueCodes(result)).toContain("FORMULA_FORWARD_REFERENCE");
  });

  it("rejects unsupported formula operations structurally", () => {
    expect(
      FormulaSchema.safeParse({
        op: "script",
        source: "return values['name-field']",
      }).success,
    ).toBe(false);
  });

  it("bounds formula depth without recursive overflow", () => {
    const parseDeepFormula = () =>
      FormulaSchema.safeParse(createNestedFormula(2_000));

    expect(FormulaSchema.safeParse(createNestedFormula(8)).success).toBe(true);
    expect(parseDeepFormula).not.toThrow();
    expect(parseDeepFormula().success).toBe(false);
  });

  it("validates field values against their field definitions", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain({
      ...sheet,
      values: { "name-field": "x".repeat(81) },
    });

    expect(issueCodes(result)).toContain("INVALID_FIELD_VALUE");
  });

  it("does not treat inherited values as playable NPC values", () => {
    const sheet = createPlayerSheet();
    const inheritedValues = Object.create({
      "name-field": "Mira Thorn",
    }) as typeof sheet.values;
    const result = validateCharacterSheetSpecDomain({
      ...sheet,
      mode: "npc",
      fields: [{ ...sheet.fields[0]!, requiredForPlayableNpc: true }],
      values: inheritedValues,
    });

    expect(issueCodes(result)).toContain("MISSING_PLAYABLE_NPC_VALUE");
  });

  it("rejects reserved identifiers and oversized value maps structurally", () => {
    const sheet = createPlayerSheet();

    expect(
      CharacterSheetSpecSchema.safeParse({
        ...sheet,
        sections: [{ ...sheet.sections[0]!, fieldIds: ["constructor"] }],
        fields: [{ ...sheet.fields[0]!, id: "constructor" }],
      }).success,
    ).toBe(false);

    const values = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`value-${index}`, index]),
    );
    expect(
      CharacterSheetSpecSchema.safeParse({ ...sheet, values }).success,
    ).toBe(false);
  });

  it("rejects invalid theme colors and layout bounds structurally", () => {
    const sheet = createPlayerSheet();

    expect(
      CharacterSheetSpecSchema.safeParse({
        ...sheet,
        theme: { ...sheet.theme, accentColor: "red" },
      }).success,
    ).toBe(false);
    expect(
      CharacterSheetSpecSchema.safeParse({
        ...sheet,
        fields: [
          {
            ...sheet.fields[0],
            placement: { ...sheet.fields[0]!.placement, columnStart: 5 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown source-map rule IDs", () => {
    const sheet = createPlayerSheet();
    const result = validateCharacterSheetSpecDomain(
      CharacterSheetSpecSchema.parse({
        ...sheet,
        sourceMap: {
          "missing-field": { ruleIds: ["missing-rule"] },
        },
      }),
      createRulesContext(),
    );

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_SOURCE_MAP_FIELD",
        "UNKNOWN_SOURCE_MAP_RULE",
      ]),
    );
  });

  it("requires RulesContext when source-map provenance is present", () => {
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      sourceMap: {
        "name-field": { ruleIds: ["rule-endurance"] },
      },
    });
    const result = validateCharacterSheetSpecDomain(sheet);

    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain("PROVENANCE_CONTEXT_REQUIRED");
  });

  it("accepts a GUI-only sheet with null rulesContextId and empty source map", () => {
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      rulesContextId: null,
      sourceMap: {},
    });

    expect(sheet.rulesContextId).toBeNull();
    expect(validateCharacterSheetSpecDomain(sheet, null)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects rulebook provenance on a null-rulesContextId sheet", () => {
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      rulesContextId: null,
      sourceMap: {
        "name-field": { ruleIds: ["rule-endurance"] },
      },
    });

    const result = validateCharacterSheetSpecDomain(sheet, null);
    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain("SOURCE_MAP_WITH_NULL_RULES_CONTEXT");
  });

  it("accepts matching source-map provenance with RulesContext", () => {
    const context = createRulesContext();
    const citation = context.normalizedRules[0]!.citations[0]!;
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      sourceMap: {
        "name-field": {
          ruleIds: ["rule-endurance"],
          citations: [citation],
        },
      },
    });

    expect(validateCharacterSheetSpecDomain(sheet, context)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects citations not attached to a referenced rule", () => {
    const baseContext = createRulesContext();
    const context = RulesContextSchema.parse({
      ...baseContext,
      normalizedRules: [
        {
          ...baseContext.normalizedRules[0]!,
          id: "rule-alpha",
          key: "alpha",
        },
        {
          ...baseContext.normalizedRules[0]!,
          id: "rule-beta",
          key: "beta",
          citations: [
            {
              sourceId: "preset-1",
              pageStart: null,
              pageEnd: null,
              section: "Character creation",
              chunkId: "beta-citation",
            },
          ],
        },
      ],
    });
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      sourceMap: {
        "name-field": {
          ruleIds: ["rule-alpha"],
          citations: [context.normalizedRules[1]!.citations[0]!],
        },
      },
    });

    expect(
      issueCodes(validateCharacterSheetSpecDomain(sheet, context)),
    ).toContain("SOURCE_MAP_CITATION_NOT_LINKED_TO_RULE");
  });

  it("accepts repeated matching provenance citations", () => {
    const context = createRulesContext();
    const citation = context.normalizedRules[0]!.citations[0]!;
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      sourceMap: {
        "name-field": {
          ruleIds: ["rule-endurance"],
          citations: [citation, citation],
        },
      },
    });

    expect(validateCharacterSheetSpecDomain(sheet, context)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects unknown source-map citations and out-of-range pages", () => {
    const context = RulesContextSchema.parse({
      ...createRulesContext(),
      sources: [
        {
          id: "rulebook-1",
          type: "uploaded-rulebook",
          filename: "local-rules.pdf",
          fileSize: 8_192,
          pageCount: 1,
          sha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          temporary: true,
        },
      ],
      authorityOrder: ["rulebook-1"],
      normalizedRules: [
        {
          ...createRulesContext().normalizedRules[0]!,
          citations: [
            {
              sourceId: "rulebook-1",
              pageStart: 1,
              pageEnd: 1,
              section: "Character creation",
              chunkId: "rulebook-character-1",
            },
          ],
        },
      ],
    });
    const sheet = CharacterSheetSpecSchema.parse({
      ...createPlayerSheet(),
      sourceMap: {
        "name-field": {
          ruleIds: ["rule-endurance"],
          citations: [
            {
              sourceId: "rulebook-1",
              pageStart: 2,
              pageEnd: 2,
              section: "Character creation",
              chunkId: "rulebook-character-1",
            },
          ],
        },
      },
    });

    expect(
      issueCodes(validateCharacterSheetSpecDomain(sheet, context)),
    ).toEqual(
      expect.arrayContaining([
        "SOURCE_MAP_CITATION_PAGE_OUT_OF_RANGE",
        "SOURCE_MAP_CITATION_NOT_LINKED_TO_RULE",
      ]),
    );
  });

  it("validates a max-shaped synthetic provenance set through indexed lookups", () => {
    const { context, sheet } = createLargeProvenanceFixture();

    expect(validateCharacterSheetSpecDomain(sheet, context)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects undeclared structural properties", () => {
    const sheet = createPlayerSheet();

    expect(
      CharacterSheetSpecSchema.safeParse({
        ...sheet,
        arbitraryCss: "color:red",
      }).success,
    ).toBe(false);
  });

  it("generates JSON Schema from the canonical Zod schema", () => {
    const jsonSchema = getCharacterSheetSpecJsonSchema();

    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        fields: expect.any(Object),
        sourceMap: expect.any(Object),
      }),
    });
  });
});
