import { describe, expect, it } from "vitest";
import { parseCanonicalCharacterSheetDraft } from "./draft-canonical";
import {
  validateDraftV2,
  CharacterSheetDraftV2Schema,
} from "./draft-schema-v2";
import { DraftError } from "./errors";
import { CharacterSheetDraftSchema } from "./draft-schema";

function makeValidV1() {
  return {
    schemaVersion: "1",
    draftId: "draft.canonical",
    sessionId: "session.canonical",
    baseVersion: 1,
    version: 1,
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
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [
      { key: "attributes", title: "Attributes", fieldKeys: ["str", "dex"] },
    ],
    values: { character_name: "Test", str: 10, dex: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeValidV2() {
  return {
    schemaVersion: "2",
    draftId: "draft.canonical",
    sessionId: "session.canonical",
    baseVersion: 1,
    version: 1,
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
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "cha",
        label: "Charisma",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [
      { key: "attributes", title: "Attributes" },
      { key: "social", title: "Social" },
    ],
    structure: [
      { kind: "section", key: "attributes", parentKey: null },
      { kind: "field", key: "str", parentKey: "attributes" },
      { kind: "field", key: "dex", parentKey: "attributes" },
      { kind: "section", key: "social", parentKey: null },
      { kind: "field", key: "cha", parentKey: "social" },
      { kind: "field", key: "character_name", parentKey: null },
    ],
    values: { character_name: "Test", str: 10, dex: 12, cha: 14 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("parseCanonicalCharacterSheetDraft", () => {
  describe("VALID", () => {
    it("valid V1 input returns schemaVersion '2'", () => {
      const v1 = makeValidV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.schemaVersion).toBe("2");
    });

    it("V1 migration preserves expected legacy structure order", () => {
      const v1 = makeValidV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      // Root section first, then its fields, then root field
      const structure = v2.structure;
      const attrsIdx = structure.findIndex(
        (p) => p.kind === "section" && p.key === "attributes",
      );
      const strIdx = structure.findIndex(
        (p) => p.kind === "field" && p.key === "str",
      );
      const dexIdx = structure.findIndex(
        (p) => p.kind === "field" && p.key === "dex",
      );
      const nameIdx = structure.findIndex(
        (p) => p.kind === "field" && p.key === "character_name",
      );

      expect(attrsIdx).toBeLessThan(strIdx);
      expect(strIdx).toBeLessThan(dexIdx);
      expect(dexIdx).toBeLessThan(nameIdx);
    });

    it("valid V2 input returns canonical V2", () => {
      const v2 = makeValidV2();
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.schemaVersion).toBe("2");
      expect(result.draftId).toBe("draft.canonical");
    });

    it("valid V2 mixed root ordering is preserved exactly", () => {
      const v2 = {
        ...makeValidV2(),
        structure: [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "dex", parentKey: "attributes" },
          { kind: "section", key: "social", parentKey: null },
          { kind: "field", key: "cha", parentKey: "social" },
        ],
      };
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.structure).toEqual(v2.structure);
    });

    it("valid nested V2 structure is preserved", () => {
      const v2 = {
        ...makeValidV2(),
        sections: [
          { key: "parent", title: "Parent" },
          { key: "child", title: "Child" },
        ],
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
        structure: [
          { kind: "section", key: "parent", parentKey: null },
          { kind: "section", key: "child", parentKey: "parent" },
          { kind: "field", key: "str", parentKey: "child" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
      };
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.structure).toEqual(v2.structure);
    });

    it("confirmed V1 becomes confirmed V2", () => {
      const v1 = { ...makeValidV1(), confirmed: true };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.confirmed).toBe(true);
    });

    it("confirmed V2 remains confirmed", () => {
      const v2 = { ...makeValidV2(), confirmed: true };
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.confirmed).toBe(true);
    });

    it("metadata remains intact", () => {
      const v1 = {
        ...makeValidV1(),
        draftId: "draft.custom",
        sessionId: "session.custom",
        baseVersion: 5,
        version: 10,
        mode: "npc" as const,
        rulesContextId: "ctx-123",
        source: { sourceSheetId: "sheet-1", sourceRunId: "run-456" },
      };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.draftId).toBe("draft.custom");
      expect(v2.sessionId).toBe("session.custom");
      expect(v2.baseVersion).toBe(5);
      expect(v2.version).toBe(10);
      expect(v2.mode).toBe("npc");
      expect(v2.rulesContextId).toBe("ctx-123");
      expect(v2.source).toEqual(v1.source);
    });

    it("values remain intact", () => {
      const v1 = {
        ...makeValidV1(),
        fields: [
          ...makeValidV1().fields,
          { key: "custom", label: "Custom", type: "text", locked: false },
        ],
        values: { character_name: "Test", str: 10, dex: 12, custom: "value" },
      };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.values).toEqual(v1.values);
    });

    it("does not mutate caller's input", () => {
      const v1 = makeValidV1();
      const originalSections = JSON.stringify(v1.sections);
      parseCanonicalCharacterSheetDraft(v1);
      expect(JSON.stringify(v1.sections)).toBe(originalSections);
    });
  });

  describe("INVALID", () => {
    it("malformed V1 rejected", () => {
      const v1 = {
        ...makeValidV1(),
        sections: [
          { key: "child", title: "Child", parentKey: "missing", fieldKeys: [] },
        ],
      };
      expect(() => parseCanonicalCharacterSheetDraft(v1)).toThrowError(
        DraftError,
      );
    });

    it("malformed V2 rejected", () => {
      const v2 = { ...makeValidV2(), structure: [] };
      expect(() => parseCanonicalCharacterSheetDraft(v2)).toThrowError(
        DraftError,
      );
    });

    it("unsupported schemaVersion rejected", () => {
      const invalid = { ...makeValidV1(), schemaVersion: "3" };
      expect(() => parseCanonicalCharacterSheetDraft(invalid)).toThrowError(
        /Unsupported schemaVersion/,
      );
    });

    it("missing schemaVersion rejected", () => {
      const invalid = { ...makeValidV1() };
      delete (invalid as any).schemaVersion;
      expect(() => parseCanonicalCharacterSheetDraft(invalid)).toThrowError(
        DraftError,
      );
    });

    it("invalid schemaVersion '2' object does NOT fall back to V1", () => {
      // V2 with invalid structure but valid V1 shape
      const invalidV2 = {
        schemaVersion: "2",
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc",
        characterName: "Test",
        rulesContextId: null,
        fields: [],
        sections: [],
        structure: [],
        values: {},
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => parseCanonicalCharacterSheetDraft(invalidV2)).toThrowError(
        DraftError,
      );
    });

    it("invalid schemaVersion '1' object does NOT fall back to V2", () => {
      // V1 with invalid section but valid V2 shape
      const invalidV1 = {
        schemaVersion: "1",
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc",
        characterName: "Test",
        rulesContextId: null,
        fields: [],
        sections: [{ key: "a", title: "A", fieldKeys: ["missing"] }],
        values: {},
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => parseCanonicalCharacterSheetDraft(invalidV1)).toThrowError(
        DraftError,
      );
    });
  });
});
