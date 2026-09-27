import { describe, expect, it } from "vitest";
import { placeDraftFieldV2 } from "./draft-field-placement";
import {
  validateDraftV2,
  CharacterSheetDraftV2Schema,
} from "./draft-schema-v2";
import { DraftError } from "./errors";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import type { DraftPlacement } from "./draft-schema-v2";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";

function makeDraft(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  const base = {
    schemaVersion: "2" as const,
    draftId: "draft.test",
    sessionId: "session.test",
    baseVersion: 1,
    version: 1,
    mode: "pc" as const,
    characterName: "Test Character",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      { key: "a", label: "A", type: "text" as const, locked: false },
      { key: "b", label: "B", type: "text" as const, locked: false },
      { key: "c", label: "C", type: "text" as const, locked: false },
      { key: "d", label: "D", type: "text" as const, locked: false },
      { key: "e", label: "E", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "x", title: "X" },
      { key: "y", title: "Y" },
      { key: "z", title: "Z" },
    ],
    structure: [
      { kind: "field" as const, key: "a", parentKey: null },
      { kind: "section" as const, key: "x", parentKey: null },
      { kind: "field" as const, key: "b", parentKey: "x" },
      { kind: "section" as const, key: "y", parentKey: "x" },
      { kind: "field" as const, key: "c", parentKey: "y" },
      { kind: "field" as const, key: "d", parentKey: "x" },
      { kind: "section" as const, key: "z", parentKey: null },
      { kind: "field" as const, key: "e", parentKey: "z" },
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: {
      a: "A",
      b: "B",
      c: "C",
      d: "D",
      e: "E",
      character_name: "Test Character",
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
  return { ...base, ...overrides };
}

function makeSimpleDraft() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.simple",
    sessionId: "session.simple",
    baseVersion: 1,
    version: 1,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      { key: "a", label: "A", type: "text" as const, locked: false },
      { key: "b", label: "B", type: "text" as const, locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "a", parentKey: null },
      { kind: "field" as const, key: "b", parentKey: null },
    ],
    values: { character_name: "Test", a: "A", b: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeRootSectionsOnlyDraft() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.sections",
    sessionId: "session.sections",
    baseVersion: 1,
    version: 1,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      {
        key: "str",
        label: "Strength",
        type: "number" as const,
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "dex",
        label: "Dexterity",
        type: "number" as const,
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [{ key: "attributes", title: "Attributes" }],
    structure: [
      { kind: "section" as const, key: "attributes", parentKey: null },
      { kind: "field" as const, key: "str", parentKey: "attributes" },
      { kind: "field" as const, key: "dex", parentKey: "attributes" },
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: { character_name: "Test", str: 10, dex: 12 },
    source: { sourceSheetId: "sheet-123", sourceRunId: "run-456" },
    confirmed: false,
  };
}

describe("draft-field-placement (2A2)", () => {
  describe("ROOT FIELD REORDER", () => {
    it("Field before Field at root (moves backward)", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "before",
        targetKey: "a",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "b", "a"]);
    });

    it("Field after Field at root (moves forward)", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftFieldV2(draft, "character_name", {
        position: "after",
        targetKey: "b",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["a", "b", "character_name"]);
    });

    it("Field before Field moves backward across indices", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "before",
        targetKey: "character_name",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["b", "character_name", "a"]);
    });

    it("Field after Field moves forward across indices", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "after",
        targetKey: "b",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "b", "a"]);
    });
  });

  describe("FIELD BEFORE/AFTER SECTION", () => {
    it("Field before Section at root", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "character_name", {
        position: "before",
        targetKey: "attributes",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "attributes", "str", "dex"]);
    });

    it("Field after Section at root uses subtree end", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "character_name", {
        position: "after",
        targetKey: "attributes",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["attributes", "str", "dex", "character_name"]);
    });

    it("Field before Section at root - str before attributes", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "str", {
        position: "before",
        targetKey: "attributes",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["str", "attributes", "dex", "character_name"]);
    });

    it("Field after Section at root - str after attributes subtree", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "str", {
        position: "after",
        targetKey: "attributes",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["attributes", "dex", "str", "character_name"]);
    });
  });

  describe("ROOT -> SECTION", () => {
    it("Root field moved inside empty Section", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "character_name", {
        position: "inside",
        parentKey: "attributes",
      });
      const namePlacement = result.structure.find(
        (p) => p.key === "character_name",
      );
      expect(namePlacement?.parentKey).toBe("attributes");
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["attributes", "str", "dex", "character_name"]);
    });

    it("Root field moved inside populated Section becomes last child", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "character_name", {
        position: "inside",
        parentKey: "attributes",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["attributes", "str", "dex", "character_name"]);
    });
  });

  describe("SECTION -> SECTION", () => {
    it("Field moved from one Section to another Section", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      const bPlacement = result.structure.find((p) => p.key === "b");
      expect(bPlacement?.parentKey).toBe("z");
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual([
        "a",
        "x",
        "y",
        "c",
        "d",
        "z",
        "e",
        "b",
        "character_name",
      ]);
    });

    it("Field moved from Section to different Section at root", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "c", {
        position: "inside",
        parentKey: "z",
      });
      const cPlacement = result.structure.find((p) => p.key === "c");
      expect(cPlacement?.parentKey).toBe("z");
    });
  });

  describe("NESTED SECTION -> ANCESTOR", () => {
    it("Field moved from nested Section to parent Section", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "c", {
        position: "inside",
        parentKey: "x",
      });
      const cPlacement = result.structure.find((p) => p.key === "c");
      expect(cPlacement?.parentKey).toBe("x");
      const keys = result.structure.map((p) => p.key);
      // c moved to end of x's subtree. Original: a, x, b, y, c, d, z, e, character_name
      // After: a, x, b, y, d, c, z, e, character_name
      expect(keys).toEqual([
        "a",
        "x",
        "b",
        "y",
        "d",
        "c",
        "z",
        "e",
        "character_name",
      ]);
    });

    it("Field moved from nested Section to root", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "c", {
        position: "inside",
        parentKey: null,
      });
      const cPlacement = result.structure.find((p) => p.key === "c");
      expect(cPlacement?.parentKey).toBeNull();
      const keys = result.structure.map((p) => p.key);
      // c moved to end of root. Original: a, x, b, y, c, d, z, e, character_name
      // After: a, x, b, y, d, z, e, character_name, c
      expect(keys).toEqual([
        "a",
        "x",
        "b",
        "y",
        "d",
        "z",
        "e",
        "character_name",
        "c",
      ]);
    });
  });

  describe("SECTION -> ROOT", () => {
    it("Field moved from Section to root", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "str", {
        position: "inside",
        parentKey: null,
      });
      const strPlacement = result.structure.find((p) => p.key === "str");
      expect(strPlacement?.parentKey).toBeNull();
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["attributes", "dex", "character_name", "str"]);
    });
  });

  describe("INSIDE MEANS LAST DIRECT CHILD", () => {
    it("Field inside empty Section becomes only child", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: "z",
      });
      const aPlacement = result.structure.find((p) => p.key === "a");
      expect(aPlacement?.parentKey).toBe("z");
      const keys = result.structure.map((p) => p.key);
      // a moved from root to inside z. Original: a, x, b, y, c, d, z, e, character_name
      // After: x, b, y, c, d, z, e, a, character_name
      expect(keys).toEqual([
        "x",
        "b",
        "y",
        "c",
        "d",
        "z",
        "e",
        "a",
        "character_name",
      ]);
    });

    it("Field inside populated Section becomes last child", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: "x",
      });
      const aPlacement = result.structure.find((p) => p.key === "a");
      expect(aPlacement?.parentKey).toBe("x");
      const keys = result.structure.map((p) => p.key);
      // a moved to end of x's subtree. Original: a, x, b, y, c, d, z, e, character_name
      // After: x, b, y, c, d, a, z, e, character_name
      expect(keys).toEqual([
        "x",
        "b",
        "y",
        "c",
        "d",
        "a",
        "z",
        "e",
        "character_name",
      ]);
    });

    it("Field inside nested Section becomes last direct child", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: "y",
      });
      const aPlacement = result.structure.find((p) => p.key === "a");
      expect(aPlacement?.parentKey).toBe("y");
      const keys = result.structure.map((p) => p.key);
      // a moved to end of y's subtree. Original: a, x, b, y, c, d, z, e, character_name
      // After: x, b, y, c, a, d, z, e, character_name
      expect(keys).toEqual([
        "x",
        "b",
        "y",
        "c",
        "a",
        "d",
        "z",
        "e",
        "character_name",
      ]);
    });

    it("Field inside root becomes last root element", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: null,
      });
      const aPlacement = result.structure.find((p) => p.key === "a");
      expect(aPlacement?.parentKey).toBeNull();
      const keys = result.structure.map((p) => p.key);
      // a moved to end of root. Original: a, x, b, y, c, d, z, e, character_name
      // After: x, b, y, c, d, z, e, character_name, a
      expect(keys).toEqual([
        "x",
        "b",
        "y",
        "c",
        "d",
        "z",
        "e",
        "character_name",
        "a",
      ]);
    });
  });

  describe("MIXED FIELD/SECTION ORDERING PRESERVED", () => {
    it("Relative order of unrelated nodes unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("x");
      const yIndex = keys.indexOf("y");
      const zIndex = keys.indexOf("z");
      const eIndex = keys.indexOf("e");
      expect(xIndex).toBeLessThan(yIndex);
      expect(yIndex).toBeLessThan(zIndex);
      expect(zIndex).toBeLessThan(eIndex);
    });

    it("Structure interleaving preserved", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: "y",
      });
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("x");
      const bIndex = keys.indexOf("b");
      const yIndex = keys.indexOf("y");
      const cIndex = keys.indexOf("c");
      const aIndex = keys.indexOf("a");
      expect(xIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(yIndex);
      expect(yIndex).toBeLessThan(cIndex);
      expect(cIndex).toBeLessThan(aIndex);
    });
  });

  describe("CONTENT REGISTRIES UNCHANGED", () => {
    it("fields[] unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.fields).toEqual(draft.fields);
    });

    it("sections[] unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.sections).toEqual(draft.sections);
    });

    it("values unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.values).toEqual(draft.values);
    });

    it("characterName unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.characterName).toBe(draft.characterName);
    });

    it("metadata/source unchanged", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.source).toEqual(draft.source);
      expect(result.draftId).toBe(draft.draftId);
      expect(result.sessionId).toBe(draft.sessionId);
      expect(result.baseVersion).toBe(draft.baseVersion);
      expect(result.version).toBe(draft.version);
      expect(result.mode).toBe(draft.mode);
      expect(result.rulesContextId).toBe(draft.rulesContextId);
      expect(result.confirmed).toBe(draft.confirmed);
    });
  });

  describe("UNRELATED PLACEMENTS UNCHANGED", () => {
    it("Other placements retain same parentKey", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      const xPlacement = result.structure.find((p) => p.key === "x");
      const yPlacement = result.structure.find((p) => p.key === "y");
      const zPlacement = result.structure.find((p) => p.key === "z");
      expect(xPlacement?.parentKey).toBeNull();
      expect(yPlacement?.parentKey).toBe("x");
      expect(zPlacement?.parentKey).toBeNull();
    });

    it("Other field placements retain same parentKey", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      const aPlacement = result.structure.find((p) => p.key === "a");
      const cPlacement = result.structure.find((p) => p.key === "c");
      const dPlacement = result.structure.find((p) => p.key === "d");
      const ePlacement = result.structure.find((p) => p.key === "e");
      expect(aPlacement?.parentKey).toBeNull();
      expect(cPlacement?.parentKey).toBe("y");
      expect(dPlacement?.parentKey).toBe("x");
      expect(ePlacement?.parentKey).toBe("z");
    });
  });

  describe("MOVED FIELD RECEIVES CORRECT PARENTKEY", () => {
    it("Moved field parentKey updated to destination parent", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      const bPlacement = result.structure.find((p) => p.key === "b");
      expect(bPlacement?.parentKey).toBe("z");
    });

    it("Moved field parentKey updated to null for root", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: null,
      });
      const bPlacement = result.structure.find((p) => p.key === "b");
      expect(bPlacement?.parentKey).toBeNull();
    });

    it("Moved field parentKey updated for before/after at root", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "before",
        targetKey: "a",
      });
      const bPlacement = result.structure.find((p) => p.key === "b");
      expect(bPlacement?.parentKey).toBeNull();
    });

    it("Moved field parentKey updated for before/after inside Section", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "before",
        targetKey: "c",
      });
      const bPlacement = result.structure.find((p) => p.key === "b");
      expect(bPlacement?.parentKey).toBe("y");
    });
  });

  describe("RESULTING DRAFT PASSES V2 VALIDATION", () => {
    it("Result passes validateDraftV2 after root reorder", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "before",
        targetKey: "a",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("Result passes validateDraftV2 after Section -> Section", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("Result passes validateDraftV2 after nested -> ancestor", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "c", {
        position: "inside",
        parentKey: "x",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("Result passes validateDraftV2 after Section -> Root", () => {
      const draft = makeRootSectionsOnlyDraft();
      const result = placeDraftFieldV2(draft, "str", {
        position: "inside",
        parentKey: null,
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("Result passes validateDraftV2 after inside", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "a", {
        position: "inside",
        parentKey: "y",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("INVALID CASES", () => {
    it("Unknown field rejected", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "ghost", {
          position: "before",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Section key passed as fieldKey rejected", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "x", {
          position: "before",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Invalid destination rejected (unknown target for before)", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "b", {
          position: "before",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("Invalid destination rejected (unknown target for after)", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "b", {
          position: "after",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("Invalid destination rejected (unknown parent for inside)", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "b", {
          position: "inside",
          parentKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("Self before rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        placeDraftFieldV2(draft, "a", {
          position: "before",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Self after rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        placeDraftFieldV2(draft, "a", {
          position: "after",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Field before itself rejected (complex draft)", () => {
      const draft = makeDraft();
      expect(() =>
        placeDraftFieldV2(draft, "b", {
          position: "before",
          targetKey: "b",
        }),
      ).toThrowError(DraftError);
    });
  });

  describe("IMMUTABILITY", () => {
    it("Non-no-op does not mutate input draft", () => {
      const draft = makeDraft();
      const originalStructure = JSON.stringify(draft.structure);
      placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });

    it("Original structure array is not mutated (new array returned)", () => {
      const draft = makeDraft();
      const originalStructureRef = draft.structure;
      const result = placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(result.structure).not.toBe(originalStructureRef);
    });

    it("Original moved placement object is not mutated", () => {
      const draft = makeDraft();
      const originalPlacement = draft.structure.find((p) => p.key === "b");
      const originalParentKey = originalPlacement?.parentKey;
      placeDraftFieldV2(draft, "b", {
        position: "inside",
        parentKey: "z",
      });
      expect(originalPlacement?.parentKey).toBe(originalParentKey);
    });

    it("No-op returns exact original draft reference", () => {
      const draft = makeDraft();
      const result = placeDraftFieldV2(draft, "d", {
        position: "inside",
        parentKey: "x",
      });
      expect(result).toBe(draft);
    });

    it("No-op does not create new structure array", () => {
      const draft = makeDraft();
      const originalStructureRef = draft.structure;
      const result = placeDraftFieldV2(draft, "d", {
        position: "inside",
        parentKey: "x",
      });
      expect(result.structure).toBe(originalStructureRef);
    });
  });
});
