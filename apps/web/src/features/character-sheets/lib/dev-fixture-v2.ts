import {
  defaultDraftLayoutV1,
  initialDraftVersionV2,
  type CharacterSheetDraftV2,
  type DraftField,
} from "@repo/character-sheet-draft";

/**
 * Development fixtures for the V2 Character Workshop. These emit direct
 * canonical V2 snapshots (`schemaVersion: "2"`, explicit `structure[]`,
 * every Field carrying exactly one placement). No V1 migration is involved:
 * there are no `fieldKeys`, no Section `parentKey`, and no registry-order
 * inference. Production real usage starts from a blank manual layout.
 */
export function createBlankDraftV2(sessionId: string): CharacterSheetDraftV2 {
  const sections: CharacterSheetDraftV2["sections"] = [];
  const structure: CharacterSheetDraftV2["structure"] = [
    { kind: "field", key: "character_name", parentKey: null },
  ];
  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: crypto.randomUUID(),
    sessionId,
    mode: "npc",
    characterName: null,
    rulesContextId: null,
    fields: [blankNameField()],
    sections,
    structure,
    layout: defaultDraftLayoutV1({ sections, structure }),
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  });
}

export function createExampleDraftV2(sessionId: string): CharacterSheetDraftV2 {
  const fields = exampleFields();
  const sections: CharacterSheetDraftV2["sections"] = [];
  const structure: CharacterSheetDraftV2["structure"] = fields.map((field) => ({
    kind: "field" as const,
    key: field.key,
    parentKey: null,
  }));
  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: crypto.randomUUID(),
    sessionId,
    mode: "npc",
    characterName: "Wayfarer of the Ash Fen",
    rulesContextId: null,
    fields,
    sections,
    structure,
    layout: defaultDraftLayoutV1({ sections, structure }),
    values: {
      character_name: "Wayfarer of the Ash Fen",
      homeland: "Coastal Marshes",
      vocation: "Greenwood scout",
      age: 29,
      aspiration:
        "To map the drowned fenroads and deliver letters through the marsh gate.",
      sworn_band: true,
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  });
}

function blankNameField(): DraftField {
  return {
    key: "character_name",
    label: "Character name",
    type: "text",
    locked: false,
  };
}

function exampleFields(): DraftField[] {
  return [
    {
      key: "character_name",
      label: "Character name",
      type: "text",
      locked: false,
    },
    {
      key: "homeland",
      label: "Homeland",
      type: "choice",
      locked: false,
      options: [
        "Northwoods",
        "Coastal Marshes",
        "High Steppes",
        "Old Empire",
        "Scattered Isles",
      ],
    },
    {
      key: "vocation",
      label: "Vocation",
      type: "text",
      locked: false,
    },
    {
      key: "age",
      label: "Age",
      type: "number",
      locked: false,
      min: 1,
      max: 120,
    },
    {
      key: "aspiration",
      label: "Aspiration",
      type: "textarea",
      locked: false,
    },
    {
      key: "sworn_band",
      label: "Sworn to a band",
      type: "checkbox",
      locked: false,
    },
  ];
}
