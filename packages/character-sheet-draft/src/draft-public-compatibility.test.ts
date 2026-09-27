import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  CharacterSheetDraftV2Schema,
  DraftError,
  parseCanonicalCharacterSheetDraft,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";

function makeValidV1() {
  return {
    schemaVersion: "1" as const,
    draftId: "draft.public",
    sessionId: "session.public",
    baseVersion: 2,
    version: 5,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      {
        key: "str",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [{ key: "attributes", title: "Attributes", fieldKeys: ["str"] }],
    values: { character_name: "Test", str: 10 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeValidV2() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.public",
    sessionId: "session.public",
    baseVersion: 4,
    version: 9,
    mode: "npc" as const,
    characterName: "Goblin",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      {
        key: "str",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [{ key: "attributes", title: "Attributes" }],
    structure: [
      { kind: "section" as const, key: "attributes", parentKey: null },
      { kind: "field" as const, key: "str", parentKey: "attributes" },
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: { character_name: "Goblin", str: 14 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

describe("public compatibility boundary", () => {
  it("parseCanonicalCharacterSheetDraft is publicly importable", () => {
    expect(typeof parseCanonicalCharacterSheetDraft).toBe("function");
  });

  it("CharacterSheetDraftV2Schema is publicly importable", () => {
    expect(typeof CharacterSheetDraftV2Schema.safeParse).toBe("function");
  });

  it("validateDraftV2 is publicly importable", () => {
    expect(typeof validateDraftV2).toBe("function");
  });

  it("CHARACTER_SHEET_DRAFT_V2_VERSION is publicly importable", () => {
    expect(CHARACTER_SHEET_DRAFT_V2_VERSION).toBe("2");
  });

  describe("V1 -> canonical V2 through the public parser", () => {
    it("returns schemaVersion '2'", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeValidV1());
      expect(v2.schemaVersion).toBe("2");
    });

    it("migrated result passes public validateDraftV2", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV1());
      expect(validateDraftV2(result)).toEqual(result);
    });

    it("preserves the V1 version", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeValidV1());
      expect(v2.version).toBe(5);
    });

    it("preserves the V1 baseVersion", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeValidV1());
      expect(v2.baseVersion).toBe(2);
    });

    it("preserves the V1 confirmed flag", () => {
      const v1 = { ...makeValidV1(), confirmed: true };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.confirmed).toBe(true);
    });

    it("preserves values", () => {
      const v1 = {
        ...makeValidV1(),
        fields: [
          ...makeValidV1().fields,
          { key: "custom", label: "Custom", type: "text", locked: false },
        ],
        values: { character_name: "Test", str: 10, custom: "value" },
      };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.values).toEqual(v1.values);
    });

    it("does not mutate the input V1 object", () => {
      const v1 = makeValidV1();
      const snapshot = JSON.stringify(v1);
      parseCanonicalCharacterSheetDraft(v1);
      expect(JSON.stringify(v1)).toBe(snapshot);
    });
  });

  describe("V2 -> canonical V2 through the public parser", () => {
    it("accepts a valid V2 snapshot", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result.schemaVersion).toBe("2");
    });

    it("returned result is valid V2", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(CharacterSheetDraftV2Schema.safeParse(result).success).toBe(true);
    });

    it("preserves the version", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result.version).toBe(9);
    });

    it("preserves the baseVersion", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result.baseVersion).toBe(4);
    });

    it("preserves the confirmed flag", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result.confirmed).toBe(true);
    });
  });

  describe("invalid and unknown input", () => {
    it("rejects an unknown schemaVersion", () => {
      const input = { ...makeValidV1(), schemaVersion: "3" };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("rejects malformed V1", () => {
      const input = {
        ...makeValidV1(),
        sections: [{ key: "broken", title: "Broken", fieldKeys: ["missing"] }],
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("rejects malformed V2", () => {
      const input = { ...makeValidV2(), structure: [] };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("does NOT fall back from invalid V1 to V2", () => {
      const input = {
        ...makeValidV1(),
        schemaVersion: "1" as const,
        structure: [
          { kind: "field" as const, key: "str", parentKey: null },
          {
            kind: "field" as const,
            key: "character_name",
            parentKey: null,
          },
        ],
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("does NOT fall back from invalid V2 to V1", () => {
      const input = {
        ...makeValidV1(),
        schemaVersion: "2" as const,
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("returns typed canonical V2 from the public parser", () => {
      const v2: CharacterSheetDraftV2 =
        parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(v2.schemaVersion).toBe("2");
    });
  });
});
