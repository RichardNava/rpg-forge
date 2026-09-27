import { describe, expect, it } from "vitest";
import { placeDraftSectionV2 } from "./draft-section-placement";
import { validateDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";

function makeComplexDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.complex",
    sessionId: "session.complex",
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
      { key: "A", label: "Field A", type: "text" as const, locked: false },
      { key: "B", label: "Field B", type: "text" as const, locked: false },
      { key: "C", label: "Field C", type: "text" as const, locked: false },
      { key: "X1", label: "X1", type: "text" as const, locked: false },
      { key: "Y1", label: "Y1", type: "text" as const, locked: false },
      { key: "Q1", label: "Q1", type: "text" as const, locked: false },
      { key: "X2", label: "X2", type: "text" as const, locked: false },
      { key: "Z1", label: "Z1", type: "text" as const, locked: false },
      { key: "W1", label: "W1", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "X", title: "Section X" },
      { key: "Y", title: "Section Y" },
      { key: "Q", title: "Section Q" },
      { key: "Z", title: "Section Z" },
      { key: "W", title: "Section W" },
    ],
    structure: [
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "field" as const, key: "X1", parentKey: "X" },
      { kind: "section" as const, key: "Y", parentKey: "X" },
      { kind: "field" as const, key: "Y1", parentKey: "Y" },
      { kind: "section" as const, key: "Q", parentKey: "Y" },
      { kind: "field" as const, key: "Q1", parentKey: "Q" },
      { kind: "field" as const, key: "X2", parentKey: "X" },
      { kind: "field" as const, key: "B", parentKey: null },
      { kind: "section" as const, key: "Z", parentKey: null },
      { kind: "field" as const, key: "Z1", parentKey: "Z" },
      { kind: "section" as const, key: "W", parentKey: "Z" },
      { kind: "field" as const, key: "W1", parentKey: "W" },
      { kind: "field" as const, key: "C", parentKey: null },
      { kind: "field" as const, key: "character_name", parentKey: null },
    ],
    values: {
      character_name: "Test Character",
      A: "A",
      B: "B",
      C: "C",
      X1: "X1",
      Y1: "Y1",
      Q1: "Q1",
      X2: "X2",
      Z1: "Z1",
      W1: "W1",
    },
    source: { sourceSheetId: "sheet-123", sourceRunId: "run-456" },
    confirmed: false,
  };
}

function makeSimpleRootDraft() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.root",
    sessionId: "session.root",
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
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "B", label: "B", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "X", title: "X" },
      { key: "Y", title: "Y" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "section" as const, key: "Y", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "field" as const, key: "B", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", B: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeNestedDraft() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.nested",
    sessionId: "session.nested",
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
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "X1", label: "X1", type: "text" as const, locked: false },
      { key: "Y1", label: "Y1", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "X", title: "X" },
      { key: "Y", title: "Y" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "field" as const, key: "X1", parentKey: "X" },
      { kind: "section" as const, key: "Y", parentKey: "X" },
      { kind: "field" as const, key: "Y1", parentKey: "Y" },
      { kind: "field" as const, key: "A", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", X1: "X1", Y1: "Y1" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeSectionWithFieldsDraft() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.secfields",
    sessionId: "session.secfields",
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
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "X1", label: "X1", type: "text" as const, locked: false },
      { key: "X2", label: "X2", type: "text" as const, locked: false },
    ],
    sections: [{ key: "X", title: "X" }],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "field" as const, key: "X1", parentKey: "X" },
      { kind: "field" as const, key: "X2", parentKey: "X" },
      { kind: "field" as const, key: "A", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", X1: "X1", X2: "X2" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("draft-section-placement (2A3)", () => {
  describe("ROOT REORDERING", () => {
    it("Section before root Field", () => {
      const draft = makeSimpleRootDraft();
      // Structure: character_name, X, Y, A, B
      // Move X before A (index 3) -> X goes to index 3, but Y is at 2, so result: character_name, Y, X, A, B
      const result = placeDraftSectionV2(draft, "X", {
        position: "before",
        targetKey: "A",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("Section after root Field", () => {
      const draft = makeSimpleRootDraft();
      // Structure: character_name, X, Y, A, B
      // Move X after A (index 3) -> after A is index 4, X removed from 1, so result: character_name, Y, A, X, B
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "A",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "A", "X", "B"]);
    });

    it("Section before root Section", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "before",
        targetKey: "X",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("Section after root Section", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Y",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("after Section lands after COMPLETE target subtree", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      // Z's subtree: Z, Z1, W, W1
      // X moves after Z's complete subtree
      const zIndex = keys.indexOf("Z");
      const wIndex = keys.indexOf("W");
      const w1Index = keys.indexOf("W1");
      const xIndex = keys.indexOf("X");
      expect(zIndex).toBeLessThan(wIndex);
      expect(wIndex).toBeLessThan(w1Index);
      expect(w1Index).toBeLessThan(xIndex);
    });

    it("move earlier Section after later Section", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Y",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("move later Section before earlier Section", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "before",
        targetKey: "X",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("move first Section subtree to last Root position", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "inside",
        parentKey: null,
      });
      const keys = result.structure.map((p) => p.key);
      // X moves to end of root
      const lastRootIdx = keys.lastIndexOf("character_name");
      const xIndex = keys.indexOf("X");
      expect(xIndex).toBe(lastRootIdx + 1);
    });

    it("move last Section subtree to first Root position", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Z", {
        position: "before",
        targetKey: "A",
      });
      const keys = result.structure.map((p) => p.key);
      // character_name is at the END in complex draft (index 14)
      // Z moves before A (index 8), so Z becomes first element
      expect(keys[0]).toBe("Z");
      expect(keys[1]).toBe("Z1");
    });

    it("same-location before returns original draft", () => {
      const draft = makeSimpleRootDraft();
      // Y is at index 2, X at index 1. Moving Y before X is a no-op since Y is already after X
      // Actually Y is at 2, X at 1. Before X means index 1. Y at 2 moves to 1, but then X shifts to 2.
      // Let's test a true no-op: moving X before Y when X is already before Y
      const result = placeDraftSectionV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      // X is at 1, Y at 2. X before Y is no-op.
      expect(result).toBe(draft);
    });

    it("same-location after returns original draft", () => {
      const draft = makeSimpleRootDraft();
      // Y after X is already the case
      const result = placeDraftSectionV2(draft, "Y", {
        position: "after",
        targetKey: "X",
      });
      expect(result).toBe(draft);
    });
  });

  describe("REPARENTING", () => {
    it("Root Section inside empty Section", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("X");
      const keys = result.structure.map((p) => p.key);
      // Y moved inside X, X has no other children so Y becomes first child
      // Structure: character_name, X, Y, A, B
      expect(keys).toEqual(["character_name", "X", "Y", "A", "B"]);
    });

    it("Root Section inside populated Section", () => {
      const draft = makeSectionWithFieldsDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "inside",
        parentKey: null, // This would be root, let's use a different fixture
      });
      // Let's test with complex draft - move Z inside X
      const complexDraft = makeComplexDraft();
      const result2 = placeDraftSectionV2(complexDraft, "Z", {
        position: "inside",
        parentKey: "X",
      });
      const zPlacement = result2.structure.find((p) => p.key === "Z");
      expect(zPlacement?.parentKey).toBe("X");
    });

    it("Root Section inside Section with nested subtree", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Z", {
        position: "inside",
        parentKey: "X",
      });
      const zPlacement = result.structure.find((p) => p.key === "Z");
      expect(zPlacement?.parentKey).toBe("X");
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("X");
      const x2Index = keys.indexOf("X2");
      const zIndex = keys.indexOf("Z");
      // Z should be after X's existing children (X2 is last child of X)
      expect(xIndex).toBeLessThan(x2Index);
      expect(x2Index).toBeLessThan(zIndex);
    });

    it("nested Section from A to B", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("Z");
      const keys = result.structure.map((p) => p.key);
      const zIndex = keys.indexOf("Z");
      const wIndex = keys.indexOf("W");
      const yIndex = keys.indexOf("Y");
      // Y should be last child of Z (after W subtree)
      expect(zIndex).toBeLessThan(wIndex);
      expect(wIndex).toBeLessThan(yIndex);
    });

    it("nested Section to ancestor Section", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Q", {
        position: "inside",
        parentKey: "X",
      });
      const qPlacement = result.structure.find((p) => p.key === "Q");
      expect(qPlacement?.parentKey).toBe("X");
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("X");
      const x2Index = keys.indexOf("X2");
      const qIndex = keys.indexOf("Q");
      // Q should be after X's existing children
      expect(xIndex).toBeLessThan(x2Index);
      expect(x2Index).toBeLessThan(qIndex);
    });

    it("nested Section back to Root", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: null,
      });
      const yPlacement = result.structure.map((p) => p.key);
      const yPlacementObj = result.structure.find((p) => p.key === "Y");
      expect(yPlacementObj?.parentKey).toBeNull();
      const keys = result.structure.map((p) => p.key);
      // Y's subtree (Q, Q1) should move with it to end of root
      const yIndex = keys.indexOf("Y");
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      const charNameIndex = keys.indexOf("character_name");
      expect(charNameIndex).toBeLessThan(yIndex);
      expect(yIndex).toBeLessThan(qIndex);
      expect(qIndex).toBeLessThan(q1Index);
    });

    it("Section becomes last direct child", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("Z");
      const keys = result.structure.map((p) => p.key);
      const zIndex = keys.indexOf("Z");
      const w1Index = keys.indexOf("W1");
      const yIndex = keys.indexOf("Y");
      // Y should be after W's complete subtree (W1 is last descendant of Z)
      expect(zIndex).toBeLessThan(w1Index);
      expect(w1Index).toBeLessThan(yIndex);
    });

    it("Section becomes last Root node", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "inside",
        parentKey: null,
      });
      const xPlacement = result.structure.find((p) => p.key === "X");
      expect(xPlacement?.parentKey).toBeNull();
      const keys = result.structure.map((p) => p.key);
      const lastIdx = keys.lastIndexOf("character_name");
      const xIndex = keys.indexOf("X");
      expect(xIndex).toBe(lastIdx + 1);
    });
  });

  describe("COMPLETE SUBTREE MOVEMENT", () => {
    it("leaf Section moves as one entry", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Q", {
        position: "inside",
        parentKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      // Q and Q1 should move together
      expect(q1Index).toBe(qIndex + 1);
    });

    it("Section + Field descendant move together", () => {
      const draft = makeSectionWithFieldsDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "inside",
        parentKey: null,
      });
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("X");
      const x1Index = keys.indexOf("X1");
      const x2Index = keys.indexOf("X2");
      // X, X1, X2 should move together
      expect(x1Index).toBe(xIndex + 1);
      expect(x2Index).toBe(xIndex + 2);
    });

    it("Section + nested Section move together", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const yIndex = keys.indexOf("Y");
      const y1Index = keys.indexOf("Y1");
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      // Y's subtree: Y, Y1, Q, Q1 (preorder)
      // Y, Q, Q1 should move together with Y1 between Y and Q
      expect(y1Index).toBe(yIndex + 1);
      expect(qIndex).toBe(yIndex + 2);
      expect(q1Index).toBe(qIndex + 1);
    });

    it("deep nested subtree remains contiguous", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("X");
      const x1Index = keys.indexOf("X1");
      const yIndex = keys.indexOf("Y");
      const y1Index = keys.indexOf("Y1");
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      const x2Index = keys.indexOf("X2");
      // All of X's subtree should remain contiguous
      expect(x1Index).toBe(xIndex + 1);
      expect(yIndex).toBe(xIndex + 2);
      expect(y1Index).toBe(yIndex + 1);
      expect(qIndex).toBe(yIndex + 2);
      expect(q1Index).toBe(qIndex + 1);
      expect(x2Index).toBe(xIndex + 6);
    });

    it("mixed Field/Section descendant order preserved", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const xIndex = keys.indexOf("X");
      // Order inside X: X1 (field), Y (section), Y1 (field), Q (section), Q1 (field), X2 (field)
      const x1Index = keys.indexOf("X1");
      const yIndex = keys.indexOf("Y");
      const y1Index = keys.indexOf("Y1");
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      const x2Index = keys.indexOf("X2");
      expect(x1Index).toBeLessThan(yIndex);
      expect(yIndex).toBeLessThan(y1Index);
      expect(y1Index).toBeLessThan(qIndex);
      expect(qIndex).toBeLessThan(q1Index);
      expect(q1Index).toBeLessThan(x2Index);
    });

    it("subtree root appears at expected destination", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const zIndex = keys.indexOf("Z");
      const w1Index = keys.indexOf("W1");
      const yIndex = keys.indexOf("Y");
      // Y should appear at end of Z's children (after W1)
      expect(zIndex).toBeLessThan(w1Index);
      expect(w1Index).toBeLessThan(yIndex);
    });

    it("every descendant remains immediately within same moved block", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      // No element from outside X's subtree should appear between X's elements
      const xIndex = keys.indexOf("X");
      const x2Index = keys.indexOf("X2");
      // All X's descendants should be between X and X2
      const x1Index = keys.indexOf("X1");
      const yIndex = keys.indexOf("Y");
      const y1Index = keys.indexOf("Y1");
      const qIndex = keys.indexOf("Q");
      const q1Index = keys.indexOf("Q1");
      expect(xIndex).toBeLessThan(x1Index);
      expect(xIndex).toBeLessThan(yIndex);
      expect(xIndex).toBeLessThan(y1Index);
      expect(xIndex).toBeLessThan(qIndex);
      expect(xIndex).toBeLessThan(q1Index);
      expect(xIndex).toBeLessThan(x2Index);
      expect(x1Index).toBeLessThan(x2Index);
      expect(yIndex).toBeLessThan(x2Index);
      expect(y1Index).toBeLessThan(x2Index);
      expect(qIndex).toBeLessThan(x2Index);
      expect(q1Index).toBeLessThan(x2Index);
    });

    it("no descendant is left behind at original position", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      // Verify no duplicates - each key appears exactly once
      const counts = new Map<string, number>();
      for (const key of keys) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(count).toBe(1);
      }
    });
  });

  describe("PARENT KEYS", () => {
    it("moved Section root parentKey changes correctly", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("Z");
    });

    it("descendant Field parentKey unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const x1Placement = result.structure.find((p) => p.key === "X1");
      const y1Placement = result.structure.find((p) => p.key === "Y1");
      const q1Placement = result.structure.find((p) => p.key === "Q1");
      const x2Placement = result.structure.find((p) => p.key === "X2");
      expect(x1Placement?.parentKey).toBe("X");
      expect(y1Placement?.parentKey).toBe("Y");
      expect(q1Placement?.parentKey).toBe("Q");
      expect(x2Placement?.parentKey).toBe("X");
    });

    it("descendant Section parentKey unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      const qPlacement = result.structure.find((p) => p.key === "Q");
      expect(yPlacement?.parentKey).toBe("X");
      expect(qPlacement?.parentKey).toBe("Y");
    });

    it("deeply nested descendant parentKeys unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const qPlacement = result.structure.find((p) => p.key === "Q");
      const q1Placement = result.structure.find((p) => p.key === "Q1");
      expect(qPlacement?.parentKey).toBe("Y");
      expect(q1Placement?.parentKey).toBe("Q");
    });

    it("unrelated node parentKeys unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const xPlacement = result.structure.find((p) => p.key === "X");
      const zPlacement = result.structure.find((p) => p.key === "Z");
      const wPlacement = result.structure.find((p) => p.key === "W");
      expect(xPlacement?.parentKey).toBeNull();
      expect(zPlacement?.parentKey).toBeNull();
      expect(wPlacement?.parentKey).toBe("Z");
    });
  });

  describe("CONTENT / METADATA PRESERVATION", () => {
    it("sections[] registry unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.sections).toEqual(draft.sections);
    });

    it("fields[] registry unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.fields).toEqual(draft.fields);
    });

    it("values unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.values).toEqual(draft.values);
    });

    it("characterName unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.characterName).toBe(draft.characterName);
    });

    it("source unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.source).toEqual(draft.source);
    });

    it("metadata unchanged", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(result.draftId).toBe(draft.draftId);
      expect(result.sessionId).toBe(draft.sessionId);
      expect(result.baseVersion).toBe(draft.baseVersion);
      expect(result.version).toBe(draft.version);
      expect(result.mode).toBe(draft.mode);
      expect(result.rulesContextId).toBe(draft.rulesContextId);
      expect(result.confirmed).toBe(draft.confirmed);
    });
  });

  describe("VALIDATION / MIXED ORDER", () => {
    it("mixed Root Field/Section ordering preserved", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const aIndex = keys.indexOf("A");
      const bIndex = keys.indexOf("B");
      const cIndex = keys.indexOf("C");
      const zIndex = keys.indexOf("Z");
      const xIndex = keys.indexOf("X");
      // Root level order: A, B, Z..., X..., C (character_name is at the END)
      expect(aIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(zIndex);
      expect(zIndex).toBeLessThan(xIndex);
      expect(xIndex).toBeLessThan(cIndex);
    });

    it("mixed child Field/Section ordering preserved", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      const keys = result.structure.map((p) => p.key);
      const zIndex = keys.indexOf("Z");
      const z1Index = keys.indexOf("Z1");
      const wIndex = keys.indexOf("W");
      const w1Index = keys.indexOf("W1");
      const yIndex = keys.indexOf("Y");
      // Z's children: Z1 (field), W (section), W1 (field), Y (moved section)
      expect(z1Index).toBeLessThan(wIndex);
      expect(wIndex).toBeLessThan(w1Index);
      expect(w1Index).toBeLessThan(yIndex);
    });

    it("resulting structure passes validateDraftV2", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("nested reparent result passes validateDraftV2", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "Z",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("Root reparent result passes validateDraftV2", () => {
      const draft = makeComplexDraft();
      const result = placeDraftSectionV2(draft, "X", {
        position: "inside",
        parentKey: null,
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("INVALID CASES", () => {
    it("unknown Section key rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "ghost", {
          position: "before",
          targetKey: "A",
        }),
      ).toThrowError(DraftError);
    });

    it("Field key passed as sectionKey rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "A", {
          position: "before",
          targetKey: "B",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown before target rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "before",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown after target rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "after",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown inside parent rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "inside",
          parentKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("inside parent is Field rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "inside",
          parentKey: "A",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before itself rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "before",
          targetKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after itself rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "after",
          targetKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside itself rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "inside",
          parentKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before Field descendant rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "before",
          targetKey: "X1",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after Field descendant rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "after",
          targetKey: "X1",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before Section descendant rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "before",
          targetKey: "Y",
        }),
      ).toThrowError(DraftError);
    });

    it("Section after Section descendant rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "after",
          targetKey: "Y",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside descendant Section rejected", () => {
      const draft = makeComplexDraft();
      expect(() =>
        placeDraftSectionV2(draft, "X", {
          position: "inside",
          parentKey: "Y",
        }),
      ).toThrowError(DraftError);
    });
  });

  describe("IMMUTABILITY", () => {
    it("complete input draft remains deep-equal after move", () => {
      const draft = makeComplexDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(draft).toEqual(originalDraft);
    });

    it("original structure array unchanged", () => {
      const draft = makeComplexDraft();
      const originalStructure = JSON.stringify(draft.structure);
      placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });

    it("original moved Section placement unchanged", () => {
      const draft = makeComplexDraft();
      const originalX = draft.structure.find((p) => p.key === "X");
      const originalParentKey = originalX?.parentKey;
      placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(originalX?.parentKey).toBe(originalParentKey);
    });

    it("original descendant placements unchanged", () => {
      const draft = makeComplexDraft();
      const originalX1 = draft.structure.find((p) => p.key === "X1");
      const originalY = draft.structure.find((p) => p.key === "Y");
      const originalQ = draft.structure.find((p) => p.key === "Q");
      const originalParentKeys = {
        X1: originalX1?.parentKey,
        Y: originalY?.parentKey,
        Q: originalQ?.parentKey,
      };
      placeDraftSectionV2(draft, "X", {
        position: "after",
        targetKey: "Z",
      });
      expect(draft.structure.find((p) => p.key === "X1")?.parentKey).toBe(
        originalParentKeys.X1,
      );
      expect(draft.structure.find((p) => p.key === "Y")?.parentKey).toBe(
        originalParentKeys.Y,
      );
      expect(draft.structure.find((p) => p.key === "Q")?.parentKey).toBe(
        originalParentKeys.Q,
      );
    });

    it("no-op returns exact original draft reference", () => {
      const draft = makeSimpleRootDraft();
      const result = placeDraftSectionV2(draft, "Y", {
        position: "after",
        targetKey: "X",
      });
      expect(result).toBe(draft);
    });

    it("no-op does not create new structure array", () => {
      const draft = makeSimpleRootDraft();
      const originalStructureRef = draft.structure;
      const result = placeDraftSectionV2(draft, "Y", {
        position: "after",
        targetKey: "X",
      });
      expect(result.structure).toBe(originalStructureRef);
    });
  });
});
