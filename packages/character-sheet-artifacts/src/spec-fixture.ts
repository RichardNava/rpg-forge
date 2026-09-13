import {
  CharacterSheetSpecSchema,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";

/**
 * Deterministic structurally-valid spec factory for artifact-store and
 * serialization tests. Test-local: intentionally not exported from index.
 */
export function buildBaseSpec(): CharacterSheetSpec {
  const spec = {
    schemaVersion: "1",
    mode: "player",
    metadata: {
      id: "sheet.0001",
      title: "Artifact Test Sheet",
      description: null,
      locale: "en-US",
    },
    rulesContextId: null,
    pages: [
      {
        id: "page.1",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: ["identity"],
        },
      },
    ],
    sections: [
      {
        id: "identity",
        title: "Identity",
        layout: { mode: "flow", columns: 1, order: 0, emphasis: "normal" },
        fieldIds: ["character.name"],
      },
    ],
    fields: [
      {
        type: "text",
        id: "character.name",
        label: "Character Name",
        requiredForPlayableNpc: false,
        placement: {
          order: 0,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
    ],
    values: {},
    theme: {
      style: "minimal",
      typography: "serif",
      density: "standard",
      borderStyle: "none",
      decorationIntensity: "none",
      accentColor: "#332211",
      backgroundIntent: "none",
    },
    sourceMap: {},
  } as unknown as CharacterSheetSpec;

  return CharacterSheetSpecSchema.parse(spec);
}
