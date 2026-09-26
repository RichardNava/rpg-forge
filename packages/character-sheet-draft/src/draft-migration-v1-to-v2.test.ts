import { describe, expect, it } from "vitest";
import {
  LegacyCharacterSheetDraftV1Schema,
  parseLegacyCharacterSheetDraftV1,
  migrateCharacterSheetDraftV1ToV2,
} from "./draft-migration-v1-to-v2";
import {
  CharacterSheetDraftV2Schema,
  validateDraftV2,
} from "./draft-schema-v2";
import { DraftError } from "./errors";
import { CharacterSheetDraftSchema, validateDraft } from "./draft-schema";
import type { CharacterSheetDraft } from "./draft-schema";

function makeLegacyDraft(
  overrides: Partial<CharacterSheetDraft> = {},
): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId: "draft.test",
    sessionId: "session.test",
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
        locked: false,
        min: 1,
        max: 20,
      },
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        locked: false,
        min: 1,
        max: 20,
      },
      {
        key: "cha",
        label: "Charisma",
        type: "number",
        locked: false,
        min: 1,
        max: 20,
      },
    ],
    sections: [
      { key: "attributes", title: "Attributes", fieldKeys: ["str", "dex"] },
      { key: "social", title: "Social", fieldKeys: ["cha"] },
    ],
    values: { character_name: "Test", str: 10, dex: 12, cha: 14 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

describe("V1 -> V2 migration", () => {
  describe("Strict V1 parser", () => {
    it("accepts valid V1", () => {
      const v1 = makeLegacyDraft();
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).not.toThrow();
    });

    it("rejects missing parent Section", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "child", title: "Child", parentKey: "missing", fieldKeys: [] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects unknown Field in fieldKeys", () => {
      const v1 = makeLegacyDraft({
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: ["ghost"] }],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects duplicate Field assignment", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "a", title: "A", fieldKeys: ["str"] },
          { key: "b", title: "B", fieldKeys: ["str"] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects hierarchy cycle", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "a", title: "A", parentKey: "b", fieldKeys: [] },
          { key: "b", title: "B", parentKey: "a", fieldKeys: [] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects depth > 12", () => {
      const sections = [];
      let parent: string | undefined;
      for (let i = 0; i < 14; i++) {
        const key = `level${i}`;
        sections.push({
          key,
          title: `Level ${i}`,
          parentKey: parent,
          fieldKeys: [],
        });
        parent = key;
      }
      const v1 = makeLegacyDraft({ sections });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects values referencing unknown Field", () => {
      const v1 = makeLegacyDraft({ values: { ghost: "value" } });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects invalid characterName mirror", () => {
      const v1 = makeLegacyDraft({ characterName: "Someone Else" });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects malformed V1 schemaVersion", () => {
      const v1 = { ...makeLegacyDraft(), schemaVersion: "3" };
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });
  });

  describe("VALID migration", () => {
    it("migrates simple V1 with one Section + Fields", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "attrs", title: "Attributes", fieldKeys: ["str", "dex"] },
        ],
        values: { character_name: "Test", str: 10, dex: 12 },
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.schemaVersion).toBe("2");
      expect(v2.sections).toEqual([{ key: "attrs", title: "Attributes" }]);
      const secPlacement = v2.structure.find(
        (p) => p.kind === "section" && p.key === "attrs",
      );
      expect(secPlacement?.parentKey).toBeNull();
      const strPlacement = v2.structure.find(
        (p) => p.kind === "field" && p.key === "str",
      );
      expect(strPlacement?.parentKey).toBe("attrs");
    });

    it("migrates V1 with no Sections", () => {
      const v1 = makeLegacyDraft({ sections: [] });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.sections).toEqual([]);
      expect(v2.structure.every((p) => p.kind === "field")).toBe(true);
      expect(v2.structure.every((p) => p.parentKey === null)).toBe(true);
    });

    it("migrates multiple root Sections in V1 order", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "a", title: "A", fieldKeys: ["str"] },
          { key: "b", title: "B", fieldKeys: ["dex"] },
        ],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const rootSections = v2.structure.filter(
        (p) => p.kind === "section" && p.parentKey === null,
      );
      expect(rootSections.map((p) => p.key)).toEqual(["a", "b"]);
    });

    it("migrates nested Sections", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "parent", title: "Parent", fieldKeys: ["str"] },
          {
            key: "child",
            title: "Child",
            parentKey: "parent",
            fieldKeys: ["dex"],
          },
        ],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const childPlacement = v2.structure.find(
        (p) => p.kind === "section" && p.key === "child",
      );
      expect(childPlacement?.parentKey).toBe("parent");
    });

    it("migrates multiple sibling child Sections in V1 order", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "parent", title: "Parent", fieldKeys: [] },
          {
            key: "childA",
            title: "Child A",
            parentKey: "parent",
            fieldKeys: [],
          },
          {
            key: "childB",
            title: "Child B",
            parentKey: "parent",
            fieldKeys: [],
          },
        ],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const children = v2.structure.filter(
        (p) => p.kind === "section" && p.parentKey === "parent",
      );
      expect(children.map((p) => p.key)).toEqual(["childA", "childB"]);
    });

    it("preserves fieldKeys order inside Section", () => {
      const v1 = makeLegacyDraft({
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: ["str", "dex"] }],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const fieldPlacements = v2.structure.filter(
        (p) => p.kind === "field" && p.parentKey === "attrs",
      );
      expect(fieldPlacements.map((p) => p.key)).toEqual(["str", "dex"]);
    });

    it("preserves child Section order from sections[]", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "parent", title: "Parent", fieldKeys: [] },
          {
            key: "childA",
            title: "Child A",
            parentKey: "parent",
            fieldKeys: [],
          },
          {
            key: "childB",
            title: "Child B",
            parentKey: "parent",
            fieldKeys: [],
          },
        ],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const children = v2.structure.filter(
        (p) => p.kind === "section" && p.parentKey === "parent",
      );
      expect(children.map((p) => p.key)).toEqual(["childA", "childB"]);
    });

    it("root Sections precede unassigned root Fields", () => {
      const v1 = makeLegacyDraft({
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: ["str"] }],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const rootSectionIndices = v2.structure
        .filter((p) => p.kind === "section" && p.parentKey === null)
        .map((p) => v2.structure.indexOf(p));
      const rootFieldIndices = v2.structure
        .filter((p) => p.kind === "field" && p.parentKey === null)
        .map((p) => v2.structure.indexOf(p));
      expect(Math.max(...rootSectionIndices)).toBeLessThan(
        Math.min(...rootFieldIndices),
      );
    });

    it("unassigned root Fields preserve fields[] order", () => {
      const v1 = makeLegacyDraft({
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "a", label: "A", type: "text", locked: false },
          { key: "b", label: "B", type: "text", locked: false },
        ],
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: [] }],
        values: { character_name: "Test", a: "A", b: "B" },
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      const rootFields = v2.structure.filter(
        (p) => p.kind === "field" && p.parentKey === null,
      );
      // Unassigned fields should be in fields[] order: character_name, a, b
      expect(rootFields.map((p) => p.key)).toEqual([
        "character_name",
        "a",
        "b",
      ]);
    });

    it("preserves fields[] content", () => {
      const v1 = makeLegacyDraft();
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.fields).toEqual(v1.fields);
    });

    it("strips parentKey/fieldKeys from V2 sections", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "attrs", title: "Attributes", fieldKeys: ["str"] },
          { key: "sub", title: "Sub", parentKey: "attrs", fieldKeys: ["dex"] },
        ],
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.sections[0]!).toEqual({ key: "attrs", title: "Attributes" });
      expect("parentKey" in v2.sections[0]!).toBe(false);
      expect("fieldKeys" in v2.sections[0]!).toBe(false);
      expect(v2.sections[1]!).toEqual({ key: "sub", title: "Sub" });
      expect("parentKey" in v2.sections[1]!).toBe(false);
      expect("fieldKeys" in v2.sections[1]!).toBe(false);
    });

    it("preserves values", () => {
      const v1 = makeLegacyDraft({
        values: { character_name: "Test", str: 10, custom: "value" },
      });
      const customField = {
        key: "custom",
        label: "Custom",
        type: "text" as const,
        locked: false,
      };
      const v1WithCustomField = {
        ...v1,
        fields: [...v1.fields, customField],
      };
      const v2 = migrateCharacterSheetDraftV1ToV2(v1WithCustomField);
      expect(v2.values).toEqual(v1WithCustomField.values);
    });

    it("preserves mode", () => {
      const v1 = makeLegacyDraft({ mode: "npc" });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.mode).toBe("npc");
    });

    it("preserves metadata", () => {
      const v1 = makeLegacyDraft({
        draftId: "draft.custom",
        sessionId: "session.custom",
        baseVersion: 5,
        version: 10,
        rulesContextId: "ctx-123",
        source: { sourceSheetId: "sheet-1", sourceRunId: "run-456" },
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.draftId).toBe("draft.custom");
      expect(v2.sessionId).toBe("session.custom");
      expect(v2.baseVersion).toBe(5);
      expect(v2.version).toBe(10);
      expect(v2.rulesContextId).toBe("ctx-123");
      expect(v2.source).toEqual(v1.source);
    });

    it("preserves confirmed=false", () => {
      const v1 = makeLegacyDraft({ confirmed: false });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.confirmed).toBe(false);
    });

    it("confirmed=true migrates to confirmed=true in memory", () => {
      const v1 = makeLegacyDraft({ confirmed: true });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.confirmed).toBe(true);
    });

    it("valid character_name mirror preserved", () => {
      const v1 = makeLegacyDraft({
        characterName: "Hero",
        values: { character_name: "Hero", str: 10 },
      });
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(v2.characterName).toBe("Hero");
      expect(v2.values.character_name).toBe("Hero");
    });

    it("resulting structure is accepted by CharacterSheetDraftV2Schema", () => {
      const v1 = makeLegacyDraft();
      const v2 = migrateCharacterSheetDraftV1ToV2(v1);
      expect(() => validateDraftV2(v2)).not.toThrow();
      expect(() => CharacterSheetDraftV2Schema.parse(v2)).not.toThrow();
    });

    it("input V1 object is not mutated", () => {
      const v1 = makeLegacyDraft({
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: ["str"] }],
      });
      const originalSections = JSON.stringify(v1.sections);
      migrateCharacterSheetDraftV1ToV2(v1);
      expect(JSON.stringify(v1.sections)).toBe(originalSections);
    });
  });

  describe("INVALID V1 rejected by strict parser", () => {
    it("rejects missing parent Section", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "child", title: "Child", parentKey: "missing", fieldKeys: [] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects unknown Field in fieldKeys", () => {
      const v1 = makeLegacyDraft({
        sections: [{ key: "attrs", title: "Attrs", fieldKeys: ["ghost"] }],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects duplicate Field assignment", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "a", title: "A", fieldKeys: ["str"] },
          { key: "b", title: "B", fieldKeys: ["str"] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects hierarchy cycle", () => {
      const v1 = makeLegacyDraft({
        sections: [
          { key: "a", title: "A", parentKey: "b", fieldKeys: [] },
          { key: "b", title: "B", parentKey: "a", fieldKeys: [] },
        ],
      });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects depth > 12", () => {
      const sections = [];
      let parent: string | undefined;
      for (let i = 0; i < 14; i++) {
        const key = `level${i}`;
        sections.push({
          key,
          title: `Level ${i}`,
          parentKey: parent,
          fieldKeys: [],
        });
        parent = key;
      }
      const v1 = makeLegacyDraft({ sections });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects values referencing unknown Field", () => {
      const v1 = makeLegacyDraft({ values: { ghost: "value" } });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects invalid characterName mirror", () => {
      const v1 = makeLegacyDraft({ characterName: "Someone Else" });
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });

    it("rejects malformed V1 schemaVersion", () => {
      const v1 = { ...makeLegacyDraft(), schemaVersion: "3" };
      expect(() => parseLegacyCharacterSheetDraftV1(v1)).toThrowError(
        DraftError,
      );
    });
  });
});
