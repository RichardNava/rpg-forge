import { describe, expect, it } from "vitest";
import {
  planDraftNodePlacementV2,
  DraftNodeDestinationSchema,
} from "./draft-structure-placement-plan";
import {
  validateDraftV2,
  CharacterSheetDraftV2Schema,
} from "./draft-schema-v2";
import { DraftError } from "./errors";
import { CharacterSheetDraftSchema } from "./draft-schema";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";

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
      { key: "c", label: "C", type: "text" as const, locked: false },
      { key: "d", label: "D", type: "text" as const, locked: false },
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
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: { a: "A", b: "B", c: "C", d: "D", character_name: "Test" },
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
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "a", parentKey: null },
    ],
    values: { character_name: "Test", a: "A" },
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
    ],
    sections: [{ key: "attributes", title: "Attributes" }],
    structure: [
      { kind: "section" as const, key: "attributes", parentKey: null },
      { kind: "field" as const, key: "str", parentKey: "attributes" },
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: { character_name: "Test", str: 10 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("draft-structure-placement-plan", () => {
  describe("DraftNodeDestinationSchema", () => {
    it("before with targetKey passes", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "before",
        targetKey: "test",
      });
      expect(result.success).toBe(true);
    });

    it("after with targetKey passes", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "after",
        targetKey: "test",
      });
      expect(result.success).toBe(true);
    });

    it("inside with parentKey string passes", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "inside",
        parentKey: "section1",
      });
      expect(result.success).toBe(true);
    });

    it("inside with parentKey null passes", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "inside",
        parentKey: null,
      });
      expect(result.success).toBe(true);
    });

    it("invalid position rejected", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "invalid",
        targetKey: "test",
      });
      expect(result.success).toBe(false);
    });

    it("missing targetKey for before rejected", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "before",
      });
      expect(result.success).toBe(false);
    });

    it("missing parentKey for inside rejected", () => {
      const result = DraftNodeDestinationSchema.safeParse({
        position: "inside",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RANGE CALCULATION", () => {
    it("Field moving range = one entry", () => {
      const draft = makeSimpleDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "before",
        targetKey: "character_name",
      });
      expect(plan.movingRange).toEqual({ start: 1, endExclusive: 2 });
    });

    it("leaf Section range", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "before",
        targetKey: "character_name",
      });
      expect(plan.movingRange).toEqual({ start: 6, endExclusive: 7 });
    });

    it("Section range includes Fields", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "z",
      });
      expect(plan.movingRange).toEqual({ start: 1, endExclusive: 6 });
    });

    it("Section range includes nested Sections", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "z",
      });
      // x's subtree includes x, b, y, c, d = 5 items
      expect(plan.movingRange).toEqual({ start: 1, endExclusive: 6 });
    });

    it("Section range includes complete mixed subtree", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "z",
      });
      expect(plan.movingRange).toEqual({ start: 1, endExclusive: 6 });
    });
  });

  describe("DESTINATION: BEFORE", () => {
    it("Field before Field", () => {
      const draft = makeSimpleDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "before",
        targetKey: "character_name",
      });
      expect(plan.insertionBoundaryOriginal).toBe(0);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("Field before Section uses Section start", () => {
      const draft = makeRootSectionsOnlyDraft();
      const plan = planDraftNodePlacementV2(draft, "str", {
        position: "before",
        targetKey: "attributes",
      });
      expect(plan.insertionBoundaryOriginal).toBe(0);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("Section before Field", () => {
      const draft = makeRootSectionsOnlyDraft();
      const plan = planDraftNodePlacementV2(draft, "attributes", {
        position: "before",
        targetKey: "character_name",
      });
      expect(plan.insertionBoundaryOriginal).toBe(2);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("Section before Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "before",
        targetKey: "x",
      });
      expect(plan.insertionBoundaryOriginal).toBe(1);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("moving block originally before target adjusts index", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "before",
        targetKey: "x",
      });
      expect(plan.insertionIndexAfterRemoval).toBe(1);
    });

    it("moving block originally after target preserves boundary index", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "a",
      });
      expect(plan.insertionIndexAfterRemoval).toBe(0);
    });

    it("same-parent before no-op case", () => {
      const draft = makeDraft();
      // b is at index 2, c is at index 4 (under y which is in x).
      // Move b before c - they have different parents (b under x, c under y), so not a no-op.
      const plan = planDraftNodePlacementV2(draft, "b", {
        position: "before",
        targetKey: "c",
      });
      expect(plan.isNoOp).toBe(false);
    });
  });

  describe("DESTINATION: AFTER", () => {
    it("Field after Field", () => {
      const draft = makeSimpleDraft();
      const plan = planDraftNodePlacementV2(draft, "character_name", {
        position: "after",
        targetKey: "a",
      });
      expect(plan.insertionBoundaryOriginal).toBe(2);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("Field after Section uses subtree end", () => {
      const draft = makeRootSectionsOnlyDraft();
      const plan = planDraftNodePlacementV2(draft, "character_name", {
        position: "after",
        targetKey: "attributes",
      });
      expect(plan.insertionBoundaryOriginal).toBe(2);
      expect(plan.destinationParentKey).toBeNull();
    });

    it("Section after Field", () => {
      const draft = makeRootSectionsOnlyDraft();
      const plan = planDraftNodePlacementV2(draft, "attributes", {
        position: "after",
        targetKey: "character_name",
      });
      expect(plan.insertionBoundaryOriginal).toBe(3);
    });

    it("Section after Section uses complete subtree end", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "after",
        targetKey: "z",
      });
      expect(plan.insertionBoundaryOriginal).toBe(7);
    });

    it("moving block originally before target adjusts index", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "after",
        targetKey: "z",
      });
      expect(plan.insertionIndexAfterRemoval).toBe(2);
    });

    it("moving block originally after target", () => {
      const draft = makeDraft();
      // z at 6, x at 1. Move z after x (after x's entire subtree).
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "after",
        targetKey: "x",
      });
      // boundary after x's subtree = 6. z at 6, boundary 6 <= start 6, no adjustment.
      expect(plan.insertionIndexAfterRemoval).toBe(6);
    });

    it("same-parent after no-op case", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "d", {
        position: "after",
        targetKey: "b",
      });
      expect(plan.isNoOp).toBe(false);
    });
  });

  describe("DESTINATION: INSIDE", () => {
    it("Field inside empty Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "inside",
        parentKey: "z",
      });
      expect(plan.destinationParentKey).toBe("z");
      expect(plan.insertionBoundaryOriginal).toBe(7);
    });

    it("Field inside populated Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "inside",
        parentKey: "x",
      });
      expect(plan.destinationParentKey).toBe("x");
      expect(plan.insertionBoundaryOriginal).toBe(6);
    });

    it("Field inside nested Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "inside",
        parentKey: "y",
      });
      expect(plan.destinationParentKey).toBe("y");
      expect(plan.insertionBoundaryOriginal).toBe(5);
    });

    it("Section inside empty Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "inside",
        parentKey: "y",
      });
      expect(plan.destinationParentKey).toBe("y");
      expect(plan.insertionBoundaryOriginal).toBe(5);
    });

    it("Section inside populated Section", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "inside",
        parentKey: "x",
      });
      expect(plan.destinationParentKey).toBe("x");
      expect(plan.insertionBoundaryOriginal).toBe(6);
    });

    it("node inside Root", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "z", {
        position: "inside",
        parentKey: null,
      });
      expect(plan.destinationParentKey).toBeNull();
      expect(plan.insertionBoundaryOriginal).toBe(8);
    });

    it("node already last child -> no-op", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "d", {
        position: "inside",
        parentKey: "x",
      });
      expect(plan.isNoOp).toBe(true);
    });

    it("node already last Root -> no-op", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "character_name", {
        position: "inside",
        parentKey: null,
      });
      expect(plan.isNoOp).toBe(true);
    });

    it("destination boundary uses parent subtree end", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "a", {
        position: "inside",
        parentKey: "x",
      });
      expect(plan.insertionBoundaryOriginal).toBe(6);
    });
  });

  describe("INVALID CASES", () => {
    it("unknown moving node", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "ghost", {
          position: "before",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown before target", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "before",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown after target", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "after",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown inside parent", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "inside",
          parentKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("inside target is Field rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "inside",
          parentKey: "b",
        }),
      ).toThrowError(DraftError);
    });

    it("Field before itself rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "before",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Field after itself rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "a", {
          position: "after",
          targetKey: "a",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before itself rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "before",
          targetKey: "x",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after itself rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "after",
          targetKey: "x",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside itself rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "inside",
          parentKey: "x",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before Field descendant rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "before",
          targetKey: "b",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after Field descendant rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "after",
          targetKey: "b",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before Section descendant rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "before",
          targetKey: "y",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after Section descendant rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "after",
          targetKey: "y",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside descendant Section rejected", () => {
      const draft = makeDraft();
      expect(() =>
        planDraftNodePlacementV2(draft, "x", {
          position: "inside",
          parentKey: "y",
        }),
      ).toThrowError(DraftError);
    });
  });

  describe("PLAN CONSISTENCY", () => {
    it("movingRange is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "z",
      });
      expect(plan.movingRange).toEqual({ start: 1, endExclusive: 6 });
    });

    it("currentParentKey is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "before",
        targetKey: "z",
      });
      expect(plan.currentParentKey).toBeNull();
    });

    it("destinationParentKey is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "inside",
        parentKey: "z",
      });
      expect(plan.destinationParentKey).toBe("z");
    });

    it("insertionBoundaryOriginal is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "inside",
        parentKey: "z",
      });
      expect(plan.insertionBoundaryOriginal).toBe(7);
    });

    it("insertionIndexAfterRemoval is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "inside",
        parentKey: "z",
      });
      expect(plan.insertionIndexAfterRemoval).toBe(2);
    });

    it("isNoOp is correct", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "d", {
        position: "inside",
        parentKey: "x",
      });
      expect(plan.isNoOp).toBe(true);
    });

    it("resulting structure can be simulated in test", () => {
      const draft = makeDraft();
      const plan = planDraftNodePlacementV2(draft, "x", {
        position: "inside",
        parentKey: "z",
      });

      const structure = [...draft.structure];
      const movingRange = plan.movingRange;
      const movingBlock = structure.slice(
        movingRange.start,
        movingRange.endExclusive,
      );
      const updatedBlock = movingBlock.map((p, i) =>
        i === 0 ? { ...p, parentKey: plan.destinationParentKey } : p,
      );

      const remaining = [
        ...structure.slice(0, movingRange.start),
        ...structure.slice(movingRange.endExclusive),
      ];

      const insertIndex = plan.insertionIndexAfterRemoval;
      const newStructure = [
        ...remaining.slice(0, plan.insertionIndexAfterRemoval),
        ...movingBlock.map((p, i) =>
          i === 0 ? { ...p, parentKey: plan.destinationParentKey } : p,
        ),
        ...remaining.slice(plan.insertionIndexAfterRemoval),
      ];

      const result = { ...draft, structure: newStructure };
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("IMMUTABILITY", () => {
    it("planning does not mutate draft", () => {
      const draft = makeDraft();
      const originalStructure = JSON.stringify(draft.structure);
      planDraftNodePlacementV2(draft, "x", {
        position: "inside",
        parentKey: "z",
      });
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });
  });
});
