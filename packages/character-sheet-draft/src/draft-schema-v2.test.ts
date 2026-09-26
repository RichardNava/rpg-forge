import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  CharacterSheetDraftV2Schema,
  DraftPlacement,
  DraftSectionV2,
  validateDraftV2,
} from "./draft-schema-v2";
import { DraftError } from "./errors";
import { DraftField, MAX_DRAFT_SECTION_DEPTH } from "./draft-schema";

describe("CharacterSheetDraftV2Schema", () => {
  describe("VALID cases", () => {
    it("accepts root Fields only", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [],
        structure: [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "str", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts root Sections only", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts mixed Root ordering: Field -> Section -> Field -> Section", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "a", label: "A", type: "text", locked: false },
          { key: "b", label: "B", type: "text", locked: false },
          { key: "c", label: "C", type: "text", locked: false },
        ],
        sections: [
          { key: "x", title: "X" },
          { key: "y", title: "Y" },
        ],
        structure: [
          { kind: "field", key: "a", parentKey: null },
          { kind: "section", key: "x", parentKey: null },
          { kind: "field", key: "b", parentKey: null },
          { kind: "section", key: "y", parentKey: null },
          { kind: "field", key: "c", parentKey: null },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", a: "A", b: "B", c: "C" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts mixed children inside a Section (Field -> Section -> Field)", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "a", label: "A", type: "text", locked: false },
          { key: "b", label: "B", type: "text", locked: false },
          { key: "c", label: "C", type: "text", locked: false },
        ],
        sections: [
          { key: "x", title: "X" },
          { key: "y", title: "Y" },
        ],
        structure: [
          { kind: "section", key: "x", parentKey: null },
          { kind: "field", key: "a", parentKey: "x" },
          { kind: "section", key: "y", parentKey: "x" },
          { kind: "field", key: "b", parentKey: "y" },
          { kind: "field", key: "c", parentKey: "x" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", a: "A", b: "B", c: "C" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts nested Sections", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [
          { key: "attributes", title: "Attributes" },
          { key: "physical", title: "Physical" },
        ],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "section", key: "physical", parentKey: "attributes" },
          { kind: "field", key: "str", parentKey: "physical" },
          { kind: "field", key: "dex", parentKey: "physical" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10, dex: 12 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts maximum allowed depth (12)", () => {
      const fields: DraftField[] = [
        { key: "character_name", label: "Name", type: "text", locked: false },
        { key: "deep", label: "Deep", type: "text", locked: false },
      ];
      const sections: DraftSectionV2[] = [];
      const structure: DraftPlacement[] = [
        { kind: "field", key: "character_name", parentKey: null },
      ];

      let currentParent: string | null = null;
      for (let i = 0; i < 12; i++) {
        const key = `level${i}`;
        sections.push({ key, title: `Level ${i}` });
        structure.push({
          kind: "section" as const,
          key,
          parentKey: currentParent,
        });
        currentParent = key;
      }
      structure.push({
        kind: "field" as const,
        key: "deep",
        parentKey: currentParent,
      });

      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields,
        sections,
        structure,
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts sections: [] with only root fields", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        sections: [],
        structure: [{ kind: "field", key: "character_name", parentKey: null }],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("accepts valid confirmed V2", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10, dex: 12 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: true,
      };
      const validated = validateDraftV2(draft);
      expect(validated.confirmed).toBe(true);
    });

    it("accepts valid values and character_name mirror", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Hero",
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
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Hero", str: 10, dex: 12 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).not.toThrow();
    });
  });

  describe("INVALID cases", () => {
    it("rejects missing sections property", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        structure: [{ kind: "field", key: "character_name", parentKey: null }],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      delete (draft as any).sections;
      expect(() => validateDraftV2(draft)).toThrowError(DraftError);
    });

    it("rejects missing structure property", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        sections: [],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      delete (draft as any).structure;
      expect(() => validateDraftV2(draft)).toThrowError(DraftError);
    });

    it("rejects Field missing placement", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "a", label: "A", type: "text", locked: false },
          { key: "b", label: "B", type: "text", locked: false },
        ],
        sections: [],
        structure: [{ kind: "field", key: "a", parentKey: null }],
        values: { a: "A" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /Every field must have exactly one placement/,
      );
    });

    it("rejects Section missing placement", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        sections: [
          { key: "a", title: "A" },
          { key: "b", title: "B" },
        ],
        structure: [
          { kind: "section", key: "a", parentKey: null },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /Every section must have exactly one placement/,
      );
    });

    it("rejects duplicate placement", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
        ],
        values: { character_name: "Test", str: 10, dex: 12 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(/Duplicate placement/);
    });

    it("rejects extra placement beyond fields/sections", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "ghost", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /Field placement references unknown field/,
      );
    });

    it("rejects field placement referencing missing Field", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "ghost", parentKey: "attributes" },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /references unknown field/,
      );
    });

    it("rejects section placement referencing missing Section", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "section", key: "ghost", parentKey: "attributes" },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /references unknown section/,
      );
    });

    it("rejects field placement key resolving to Section", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "attributes", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /references unknown field/,
      );
    });

    it("rejects section placement key resolving to Field", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "section", key: "str", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /references unknown section/,
      );
    });

    it("rejects same key used by a Field and a Section", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
          { key: "a", label: "A", type: "text", locked: false },
        ],
        sections: [
          { key: "attributes", title: "Attributes" },
          { key: "a", title: "A" },
        ],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "section", key: "a", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "a", parentKey: "a" },
        ],
        values: { character_name: "Test", str: 10, a: "A" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /used by both a field and a section/,
      );
    });

    it("rejects parentKey referencing Field", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [
          { key: "attributes", title: "Attributes" },
          { key: "ghost", title: "Ghost" },
        ],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "section", key: "ghost", parentKey: "str" },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /references unknown parent section/,
      );
    });

    it("rejects self-parent", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [
          { key: "attributes", title: "Attributes" },
          { key: "a", title: "A" },
        ],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "section", key: "a", parentKey: "a" },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(/cannot parent itself/);
    });

    it("rejects cycle", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        sections: [
          { key: "a", title: "A" },
          { key: "b", title: "B" },
        ],
        structure: [
          { kind: "section", key: "a", parentKey: "b" },
          { kind: "section", key: "b", parentKey: "a" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /invalid parent hierarchy/,
      );
    });

    it("rejects depth > 12", () => {
      const sections: DraftSectionV2[] = [];
      const structure: DraftPlacement[] = [
        { kind: "field", key: "character_name", parentKey: null },
      ];
      let parent: string | null = null;
      for (let i = 0; i < 14; i++) {
        const key = `level${i}`;
        sections.push({ key, title: `Level ${i}` });
        structure.push({ kind: "section", key, parentKey: parent });
        parent = key;
      }
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
        ],
        sections,
        structure,
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /invalid parent hierarchy/,
      );
    });

    it("rejects descendant before parent", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /Structure array is not in valid preorder/,
      );
    });

    it("rejects broken/non-contiguous subtree", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Test",
        rulesContextId: null,
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "f1", label: "F1", type: "text", locked: false },
          { key: "f2", label: "F2", type: "text", locked: false },
          { key: "f3", label: "F3", type: "text", locked: false },
        ],
        sections: [
          { key: "a", title: "A" },
          { key: "b", title: "B" },
        ],
        structure: [
          { kind: "section", key: "a", parentKey: null },
          { kind: "field", key: "f1", parentKey: "a" },
          { kind: "section", key: "b", parentKey: null },
          { kind: "field", key: "f2", parentKey: "a" },
          { kind: "field", key: "f3", parentKey: "b" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", f1: "1", f2: "2", f3: "3" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(/non-contiguous/);
    });

    it("rejects duplicate Field key", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
            key: "str",
            label: "Strength",
            type: "number",
            locked: false,
            min: 1,
            max: 20,
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
      expect(() => validateDraftV2(draft)).toThrowError(
        /Draft field keys must be unique/,
      );
    });

    it("rejects duplicate Section key", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [
          { key: "attributes", title: "Attributes" },
          { key: "attributes", title: "Attributes" },
        ],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /Draft section keys must be unique/,
      );
    });

    it("rejects values referencing missing Field", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10, ghost: "value" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /values reference unknown key/,
      );
    });

    it("rejects invalid characterName mirror", () => {
      const draft = {
        schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
        draftId: "draft.test",
        sessionId: "session.test",
        baseVersion: 1,
        version: 1,
        mode: "pc" as const,
        characterName: "Someone Else",
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
        ],
        sections: [{ key: "attributes", title: "Attributes" }],
        structure: [
          { kind: "section", key: "attributes", parentKey: null },
          { kind: "field", key: "str", parentKey: "attributes" },
          { kind: "field", key: "character_name", parentKey: null },
        ],
        values: { character_name: "Test", str: 10 },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      expect(() => validateDraftV2(draft)).toThrowError(
        /characterName must mirror/,
      );
    });
  });
});
