import type { CharacterSheetDraft } from "./draft-schema";

/**
 * Factory for a fully valid PC draft used across the draft suites. Locked
 * fields carry a draw grammar (bounded number, choice), so reroll suites get a
 * deterministic regeneration surface; unlocked fields stay editable. The
 * factory intentionally does not schema-parse, so tests can inject invalid
 * shapes and exercise the validators themselves.
 */
export function makeDraft(
  overrides: Partial<CharacterSheetDraft> = {},
): CharacterSheetDraft {
  const base: CharacterSheetDraft = {
    schemaVersion: "1",
    draftId: "draft.abc123",
    sessionId: "session.abc123",
    baseVersion: 1,
    version: 1,
    confirmed: false,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character Name",
        type: "text",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: true,
      },
      { key: "homeland", label: "Homeland", type: "textarea", locked: false },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow", "staff"],
        locked: true,
      },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
    ],
    sections: [],
    values: {
      character_name: "Aria Stone",
      strength: 12,
      homeland: "Riverside",
      weapon: "sword",
      veteran: true,
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
  };
  return { ...base, ...overrides };
}
