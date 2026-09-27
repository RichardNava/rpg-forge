import { describe, expect, it } from "vitest";
import {
  buildDraftStructuralIndex,
  getDraftPlacement,
  getDraftChildren,
  getDraftParentKey,
  getDraftDepth,
  getDraftSubtreeRange,
  type DraftStructuralIndex,
} from "./draft-structure";
import {
  CharacterSheetDraftV2Schema,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";

function makeDraft(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  const base: CharacterSheetDraftV2 = {
    schemaVersion: "2",
    draftId: "draft.test",
    sessionId: "session.test",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Test",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "a", label: "A", type: "text", locked: false },
      { key: "b", label: "B", type: "text", locked: false },
      { key: "c", label: "C", type: "text", locked: false },
      { key: "d", label: "D", type: "text", locked: false },
    ],
    sections: [
      { key: "x", title: "X" },
      { key: "y", title: "Y" },
      { key: "z", title: "Z" },
    ],
    structure: [
      { kind: "field", key: "a", parentKey: null },
      { kind: "section", key: "x", parentKey: null },
      { kind: "field", key: "b", parentKey: "x" },
      { kind: "section", key: "y", parentKey: "x" },
      { kind: "field", key: "c", parentKey: "y" },
      { kind: "field", key: "d", parentKey: "x" },
      { kind: "section", key: "z", parentKey: null },
      { kind: "field", key: "character_name", parentKey: null },
    ],
    values: { a: "A", b: "B", c: "C", d: "D", character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
  return { ...base, ...overrides };
}

function makeSimpleDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.simple",
    sessionId: "session.simple",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Test",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "a", label: "A", type: "text", locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "a", parentKey: null },
    ],
    values: { character_name: "Test", a: "A" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeRootSectionsOnlyDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.sections",
    sessionId: "session.sections",
    baseVersion: 1,
    version: 1,
    mode: "pc",
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
}

describe("draft-structure: buildDraftStructuralIndex", () => {
  describe("basic structure", () => {
    it("root Fields only", () => {
      const draft = makeSimpleDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(index.placementByKey.size).toBe(2);
      expect(index.childrenByParent.get(null)!.length).toBe(2);
      expect(index.childrenByParent.get("nonexistent")).toBeUndefined();
    });

    it("root Sections only", () => {
      const draft = makeRootSectionsOnlyDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(index.placementByKey.size).toBe(3);
      expect(index.childrenByParent.get(null)!.length).toBe(2);
      const rootChildren = index.childrenByParent.get(null);
      const children = (rootChildren as readonly DraftPlacement[]) ?? [];
      expect(children[0]?.kind).toBe("section");
      expect(children[1]?.kind).toBe("field");
    });

    it("depth values match V2 semantics (root = 0)", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftDepth(index, "a")).toBe(0);
      expect(getDraftDepth(index, "x")).toBe(0);
      expect(getDraftDepth(index, "b")).toBe(1);
      expect(getDraftDepth(index, "y")).toBe(1);
      expect(getDraftDepth(index, "c")).toBe(2);
      expect(getDraftDepth(index, "d")).toBe(1);
      expect(getDraftDepth(index, "z")).toBe(0);
      expect(getDraftDepth(index, "character_name")).toBe(0);
    });

    it("mixed root Field/Section order preserved", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const rootChildren = index.childrenByParent.get(null)!;
      expect(rootChildren.map((p) => p.kind)).toEqual([
        "field",
        "section",
        "section",
        "field",
      ]);
      expect(rootChildren.map((p) => p.key)).toEqual([
        "a",
        "x",
        "z",
        "character_name",
      ]);
    });

    it("mixed child Field/Section order preserved", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const xChildren = index.childrenByParent.get("x")!;
      expect(xChildren.map((p) => p.kind)).toEqual([
        "field",
        "section",
        "field",
      ]);
      expect(xChildren.map((p) => p.key)).toEqual(["b", "y", "d"]);
    });

    it("placementByKey contains all nodes using raw keys", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(index.placementByKey.has("a")).toBe(true);
      expect(index.placementByKey.has("x")).toBe(true);
      expect(index.placementByKey.has("character_name")).toBe(true);
      expect(index.placementByKey.has("y")).toBe(true);
      expect(index.placementByKey.has("b")).toBe(true);
      expect(index.placementByKey.has("c")).toBe(true);
      expect(index.placementByKey.has("z")).toBe(true);
      expect(index.placementByKey.has("d")).toBe(true);
      expect(index.placementByKey.has("character_name")).toBe(true);
      expect(index.placementByKey.has("section:x")).toBe(false);
      expect(index.placementByKey.has("field:a")).toBe(false);
    });

    it("placement lookup uses raw keys", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const placement = index.placementByKey.get("x")!;
      expect(placement.key).toBe("x");
      expect(placement.kind).toBe("section");
      expect(placement.parentKey).toBeNull();
    });
  });

  describe("childrenByParent", () => {
    it("childrenByParent(null) returns Root children in structure[] order", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const rootChildren = index.childrenByParent.get(null)!;
      expect(rootChildren.map((p) => p.key)).toEqual([
        "a",
        "x",
        "z",
        "character_name",
      ]);
    });

    it("direct children only — not descendants", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const xChildren = index.childrenByParent.get("x")!;
      expect(xChildren.map((p) => p.key)).toEqual(["b", "y", "d"]);
      expect(xChildren.some((p) => p.key === "c")).toBe(false);
    });

    it("unknown parent returns empty array via getDraftChildren", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftChildren(index, "nonexistent")).toEqual([]);
    });

    it("all children preserve structure[] ordering", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const rootChildren = index.childrenByParent.get(null)!;
      // structure[] order: a, x, z, character_name
      const indices: number[] = rootChildren.map((p): number => {
        const idx = draft.structure.findIndex((s) => s.key === p.key);
        return idx >= 0 ? idx : 0;
      });
      for (let i = 1; i < indices.length; i++) {
        const current = indices[i]!;
        const prev = indices[i - 1]!;
        expect(current).toBeGreaterThan(prev);
      }
    });
  });

  describe("parentByKey", () => {
    it("parentByKey correct for root nodes", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftParentKey(index, "a")).toBeNull();
      expect(getDraftParentKey(index, "x")).toBeNull();
      expect(getDraftParentKey(index, "z")).toBeNull();
      expect(getDraftParentKey(index, "character_name")).toBeNull();
    });

    it("parentByKey correct for nested nodes", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftParentKey(index, "b")).toBe("x");
      expect(getDraftParentKey(index, "y")).toBe("x");
      expect(getDraftParentKey(index, "c")).toBe("y");
      expect(getDraftParentKey(index, "d")).toBe("x");
    });

    it("Root parent is null", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftParentKey(index, "a")).toBeNull();
    });

    it("unknown parent returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftParentKey(index, "nonexistent")).toBeUndefined();
    });
  });

  describe("depthByKey", () => {
    it("depth values match V2 semantics (root = 0)", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftDepth(index, "a")).toBe(0);
      expect(getDraftDepth(index, "x")).toBe(0);
      expect(getDraftDepth(index, "b")).toBe(1);
      expect(getDraftDepth(index, "y")).toBe(1);
      expect(getDraftDepth(index, "c")).toBe(2);
      expect(getDraftDepth(index, "d")).toBe(1);
      expect(getDraftDepth(index, "z")).toBe(0);
      expect(getDraftDepth(index, "character_name")).toBe(0);
    });

    it("unknown depth returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftDepth(index, "nonexistent")).toBeUndefined();
    });
  });

  describe("subtreeRangeBySectionKey", () => {
    it("nested Section subtree range correct", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      // x at index 1, its subtree: x(1), b(2), y(3), c(4), d(5) -> [1, 6)
      const xRange = getDraftSubtreeRange(index, "x")!;
      expect(xRange).toEqual({ start: 1, endExclusive: 6 });
    });

    it("leaf Section subtree range", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      // y at index 3, its subtree: y(3), c(4) -> [3, 5)
      const yRange = getDraftSubtreeRange(index, "y")!;
      expect(yRange).toEqual({ start: 3, endExclusive: 5 });
    });

    it("root Section range includes all descendants", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      // z at index 6, only itself -> [6, 7)
      const zRange = getDraftSubtreeRange(index, "z")!;
      expect(zRange).toEqual({ start: 6, endExclusive: 7 });
    });

    it("sibling Section ranges do not overlap incorrectly", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const xRange = getDraftSubtreeRange(index, "x")!;
      const zRange = getDraftSubtreeRange(index, "z")!;
      expect(xRange.endExclusive).toBeLessThanOrEqual(zRange.start);
    });

    it("Section subtree includes nested Sections", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const xRange = getDraftSubtreeRange(index, "x")!;
      // x's subtree includes y (nested section) and its children
      expect(xRange.start).toBeLessThan(3); // y is at 3
      expect(xRange.endExclusive).toBeGreaterThan(4); // c is at 4
    });

    it("Section subtree includes descendant Fields", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      const xRange = getDraftSubtreeRange(index, "x")!;
      expect(xRange.start).toBeLessThan(2); // b at 2
      expect(xRange.endExclusive).toBeGreaterThan(5); // d at 5
    });

    it("field has no subtree range", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftSubtreeRange(index, "a")).toBeUndefined();
    });

    it("unknown section returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftSubtreeRange(index, "nonexistent")).toBeUndefined();
    });
  });

  describe("unknown key behavior", () => {
    it("unknown placement returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftPlacement(index, "nonexistent")).toBeUndefined();
    });

    it("unknown parent returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftParentKey(index, "nonexistent")).toBeUndefined();
    });

    it("unknown depth returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftDepth(index, "nonexistent")).toBeUndefined();
    });

    it("unknown subtree returns undefined", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftSubtreeRange(index, "nonexistent")).toBeUndefined();
    });

    it("unknown children parent returns empty array", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      expect(getDraftChildren(index, "nonexistent")).toEqual([]);
    });
  });

  describe("immutability", () => {
    it("building index does not mutate draft", () => {
      const draft = makeDraft();
      const originalStructure = JSON.stringify(draft.structure);
      buildDraftStructuralIndex(draft);
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });
  });

  describe("no compound keys", () => {
    it("no compound keys appear in any map", () => {
      const draft = makeDraft();
      const index = buildDraftStructuralIndex(draft);
      for (const key of index.placementByKey.keys()) {
        expect(key).not.toContain(":");
      }
      for (const key of index.childrenByParent.keys()) {
        if (key !== null) {
          expect(key).not.toContain(":");
        }
      }
      for (const key of index.parentByKey.keys()) {
        expect(key).not.toContain(":");
      }
      for (const key of index.depthByKey.keys()) {
        expect(key).not.toContain(":");
      }
      for (const key of index.subtreeRangeBySectionKey.keys()) {
        expect(key).not.toContain(":");
      }
    });
  });
});
