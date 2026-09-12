import {
  CharacterSheetSpecSchema,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";

/**
 * Deterministic test spec factory. Builds a structurally valid sheet with a
 * fixed field set so tests share one baseline and adapt it per scenario.
 */

export interface SpecOverrides {
  readonly values?: Record<string, string | number | boolean | null>;
  readonly mode?: "player" | "npc";
  readonly theme?: Partial<CharacterSheetSpec["theme"]>;
  readonly locale?: string | null;
  readonly title?: string;
  readonly assignments?: Record<string, unknown>;
}

export function buildBaseSpec(
  overrides: SpecOverrides = {},
): CharacterSheetSpec {
  const spec = {
    schemaVersion: "1",
    mode: overrides.mode ?? "player",
    metadata: {
      id: "test.sheet.1",
      title: overrides.title ?? "Character Sheet",
      description: null,
      locale: overrides.locale ?? "en-US",
    },
    rulesContextId: "test.context.1",
    pages: [
      {
        id: "page.1",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: ["identity", "abilities", "notes"],
        },
      },
    ],
    sections: [
      {
        id: "identity",
        title: "Identity",
        layout: { mode: "grid", columns: 2, order: 0, emphasis: "primary" },
        fieldIds: ["character.name", "archetype"],
      },
      {
        id: "abilities",
        title: "Abilities",
        layout: { mode: "grid", columns: 2, order: 1, emphasis: "normal" },
        fieldIds: ["strength", "dexterity"],
      },
      {
        id: "notes",
        title: "Notes",
        layout: { mode: "grid", columns: 1, order: 2, emphasis: "primary" },
        fieldIds: ["background"],
      },
    ],
    fields: [
      {
        type: "text",
        id: "character.name",
        label: "Character Name",
        requiredForPlayableNpc: true,
        placement: {
          order: 0,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        type: "text",
        id: "archetype",
        label: "Archetype",
        requiredForPlayableNpc: false,
        placement: {
          order: 1,
          columnStart: 2,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        type: "number",
        id: "strength",
        label: "Strength",
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
        type: "number",
        id: "dexterity",
        label: "Dexterity",
        requiredForPlayableNpc: false,
        placement: {
          order: 3,
          columnStart: 2,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
      {
        type: "textarea",
        id: "background",
        label: "Background",
        rows: 5,
        requiredForPlayableNpc: false,
        placement: {
          order: 4,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 2,
          breakBefore: false,
        },
      },
    ],
    values: overrides.values ?? { "character.name": "Aria Stone" },
    theme: {
      style: "classic",
      typography: "serif",
      density: "standard",
      borderStyle: "line",
      decorationIntensity: "subtle",
      accentColor: "#1E3A5F",
      backgroundIntent: "parchment",
      ...overrides.theme,
    },
    sourceMap: {},
    ...overrides.assignments,
  } as unknown as CharacterSheetSpec;

  return CharacterSheetSpecSchema.parse(spec);
}

/** Renders a spec with values assigned to a single field. */
export function specWithFieldValues(
  values: Record<string, string | number | boolean | null>,
  overrides: SpecOverrides = {},
): CharacterSheetSpec {
  return buildBaseSpec({ ...overrides, values });
}

/** Spec containing an unsupported field type (checkbox). */
export function specWithUnsupportedFieldType(): CharacterSheetSpec {
  const base = buildBaseSpec({ values: {} });
  const enhanced = {
    ...base,
    sections: base.sections.map((section) =>
      section.id === "identity"
        ? { ...section, fieldIds: [...section.fieldIds, "ready"] }
        : section,
    ),
    fields: [
      ...base.fields,
      {
        type: "checkbox",
        id: "ready",
        label: "Ready for play",
        requiredForPlayableNpc: false,
        placement: {
          order: 5,
          columnStart: 2,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
    ],
  } as unknown as CharacterSheetSpec;
  return CharacterSheetSpecSchema.parse(enhanced);
}

/** Multi-page spec: identity on page 1, abilities on page 2, notes on page 3. */
export function specWithMultiplePages(): CharacterSheetSpec {
  const base = buildBaseSpec();
  const enhanced = {
    ...base,
    pages: [
      {
        id: "page.1",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: ["identity"],
        },
      },
      {
        id: "page.2",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: ["abilities"],
        },
      },
      {
        id: "page.3",
        layout: {
          orientation: "portrait",
          sizeIntent: "a4",
          sectionIds: ["notes"],
        },
      },
    ],
    values: {
      "character.name": "Baron Grim",
      strength: 12,
      dexterity: 9,
      background: "Raised among the cliffs.",
    },
  } as unknown as CharacterSheetSpec;
  return CharacterSheetSpecSchema.parse(enhanced);
}

/** Spec whose values exceed the given field's supported value type. */
export function specWithWrongValueType(): CharacterSheetSpec {
  const base = buildBaseSpec();
  const enhanced = {
    ...base,
    values: { "character.name": 42 },
  } as unknown as CharacterSheetSpec;
  return CharacterSheetSpecSchema.parse(enhanced);
}

/** A read-only calculated field with a scalar snapshot value. */
export function specWithCalculatedField(): CharacterSheetSpec {
  const base = buildBaseSpec({ values: {} });
  const enhanced = {
    ...base,
    sections: base.sections.map((section) =>
      section.id === "identity"
        ? {
            ...section,
            fieldIds: ["character.name", "archetype", "level.calc"],
          }
        : section,
    ),
    fields: [
      ...base.fields,
      {
        type: "calculated",
        id: "level.calc",
        label: "Level",
        requiredForPlayableNpc: false,
        formula: { op: "literal", value: 3 },
        placement: {
          order: 6,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
    ],
    values: { "level.calc": 3 },
  } as unknown as CharacterSheetSpec;
  return CharacterSheetSpecSchema.parse(enhanced);
}
