import {
  initialDraftVersion,
  type CharacterSheetDraft,
  type DraftField,
} from "@repo/character-sheet-draft";

/**
 * Development fixtures for the Character Workshop. These are convenience
 * snapshots for exercising the editor without the generation pipeline; they
 * are intentionally opaque (system-agnostic) and never referenced by
 * production flows. Production real usage starts from a blank manual layout.
 */
export function createBlankDraft(sessionId: string): CharacterSheetDraft {
  return initialDraftVersion({
    schemaVersion: "1",
    draftId: crypto.randomUUID(),
    sessionId,
    mode: "npc",
    characterName: null,
    rulesContextId: null,
    fields: [blankNameField()],
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  });
}

export function createExampleDraft(sessionId: string): CharacterSheetDraft {
  return initialDraftVersion({
    schemaVersion: "1",
    draftId: crypto.randomUUID(),
    sessionId,
    mode: "npc",
    characterName: "Wayfarer of the Ash Fen",
    rulesContextId: null,
    fields: exampleFields(),
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
