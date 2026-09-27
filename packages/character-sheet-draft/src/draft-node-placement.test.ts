import { describe, expect, it } from "vitest";
import { placeDraftNodeV2 } from "./draft-node-placement";
import { validateDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import { buildDraftStructuralIndex } from "./draft-structure";
import {
  planDraftNodePlacementV2,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";
import { placeDraftFieldV2 } from "./draft-field-placement";
import { placeDraftSectionV2 } from "./draft-section-placement";

function makeConfirmedDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.confirmed",
    sessionId: "session.confirmed",
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
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
    ],
    values: { character_name: "Test", A: "A" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

function makeSimpleDraft(): CharacterSheetDraftV2 {
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
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "B", label: "B", type: "text" as const, locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "field" as const, key: "B", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", B: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeSectionDraft(): CharacterSheetDraftV2 {
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

function makeDeepSectionDraft(): CharacterSheetDraftV2 {
  // Root Section depth 0
  //   A depth 1
  //     B depth 2
  //       C depth 3
  return {
    schemaVersion: "2" as const,
    draftId: "draft.deep",
    sessionId: "session.deep",
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
    ],
    sections: [
      { key: "Root", title: "Root" },
      { key: "A", title: "A" },
      { key: "B", title: "B" },
      { key: "C", title: "C" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "Root", parentKey: null },
      { kind: "section" as const, key: "A", parentKey: "Root" },
      { kind: "section" as const, key: "B", parentKey: "A" },
      { kind: "section" as const, key: "C", parentKey: "B" },
    ],
    values: { character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeDepthBoundaryDraft(): CharacterSheetDraftV2 {
  // Create a destination chain at depth 10
  // Root -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 -> S10 (depth 10)
  // Moving subtree: A (root) -> B -> C (relative depth 2)
  // Inside S10: A depth 11, C depth 13 -> REJECT
  const sections = [
    { key: "Root", title: "Root" },
    { key: "S1", title: "S1" },
    { key: "S2", title: "S2" },
    { key: "S3", title: "S3" },
    { key: "S4", title: "S4" },
    { key: "S5", title: "S5" },
    { key: "S6", title: "S6" },
    { key: "S7", title: "S7" },
    { key: "S8", title: "S8" },
    { key: "S9", title: "S9" },
    { key: "S10", title: "S10" },
    { key: "A", title: "A" },
    { key: "B", title: "B" },
    { key: "C", title: "C" },
  ];

  const structure = [
    { kind: "field" as const, key: "character_name", parentKey: null },
    { kind: "section" as const, key: "Root", parentKey: null },
    { kind: "section" as const, key: "S1", parentKey: "Root" },
    { kind: "section" as const, key: "S2", parentKey: "S1" },
    { kind: "section" as const, key: "S3", parentKey: "S2" },
    { kind: "section" as const, key: "S4", parentKey: "S3" },
    { kind: "section" as const, key: "S5", parentKey: "S4" },
    { kind: "section" as const, key: "S6", parentKey: "S5" },
    { kind: "section" as const, key: "S7", parentKey: "S6" },
    { kind: "section" as const, key: "S8", parentKey: "S7" },
    { kind: "section" as const, key: "S9", parentKey: "S8" },
    { kind: "section" as const, key: "S10", parentKey: "S9" },
    // Moving subtree at root level
    { kind: "section" as const, key: "A", parentKey: null },
    { kind: "section" as const, key: "B", parentKey: "A" },
    { kind: "section" as const, key: "C", parentKey: "B" },
  ];

  return {
    schemaVersion: "2" as const,
    draftId: "draft.boundary",
    sessionId: "session.boundary",
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
    ],
    sections,
    structure,
    values: { character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeDepthBoundarySafeDraft(): CharacterSheetDraftV2 {
  // Destination chain at depth 9
  // Moving subtree relative depth 2
  // Inside S9: A depth 10, C depth 12 -> ALLOW (exactly 12)
  const sections = [
    { key: "Root", title: "Root" },
    { key: "S1", title: "S1" },
    { key: "S2", title: "S2" },
    { key: "S3", title: "S3" },
    { key: "S4", title: "S4" },
    { key: "S5", title: "S5" },
    { key: "S6", title: "S6" },
    { key: "S7", title: "S7" },
    { key: "S8", title: "S8" },
    { key: "S9", title: "S9" },
    { key: "A", title: "A" },
    { key: "B", title: "B" },
    { key: "C", title: "C" },
  ];

  const structure = [
    { kind: "field" as const, key: "character_name", parentKey: null },
    { kind: "section" as const, key: "Root", parentKey: null },
    { kind: "section" as const, key: "S1", parentKey: "Root" },
    { kind: "section" as const, key: "S2", parentKey: "S1" },
    { kind: "section" as const, key: "S3", parentKey: "S2" },
    { kind: "section" as const, key: "S4", parentKey: "S3" },
    { kind: "section" as const, key: "S5", parentKey: "S4" },
    { kind: "section" as const, key: "S6", parentKey: "S5" },
    { kind: "section" as const, key: "S7", parentKey: "S6" },
    { kind: "section" as const, key: "S8", parentKey: "S7" },
    { kind: "section" as const, key: "S9", parentKey: "S8" },
    // Moving subtree at root level
    { kind: "section" as const, key: "A", parentKey: null },
    { kind: "section" as const, key: "B", parentKey: "A" },
    { kind: "section" as const, key: "C", parentKey: "B" },
  ];

  return {
    schemaVersion: "2" as const,
    draftId: "draft.boundary.safe",
    sessionId: "session.boundary.safe",
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
    ],
    sections,
    structure,
    values: { character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeLeafAtDepthDraft(depth: number): CharacterSheetDraftV2 {
  const sections = [];
  const structure: any[] = [
    { kind: "field", key: "character_name", parentKey: null },
  ];

  let parentKey: string | null = null;
  for (let i = 0; i <= depth; i++) {
    const key = `S${i}`;
    sections.push({ key, title: key });
    structure.push({ kind: "section", key, parentKey });
    parentKey = key;
  }

  // Add moving leaf section at root
  sections.push({ key: "Leaf", title: "Leaf" });
  structure.push({ kind: "section", key: "Leaf", parentKey: null });

  return {
    schemaVersion: "2" as const,
    draftId: `draft.leaf.${depth}`,
    sessionId: `session.leaf.${depth}`,
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
    ],
    sections,
    structure,
    values: { character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeSiblingAtDepthDraft(depth: number): CharacterSheetDraftV2 {
  // Create chain to depth, then add sibling sections at that depth
  const sections = [];
  const structure: any[] = [
    { kind: "field", key: "character_name", parentKey: null },
  ];

  let parentKey: string | null = null;
  for (let i = 0; i <= depth; i++) {
    const key = `S${i}`;
    sections.push({ key, title: key });
    structure.push({ kind: "section", key, parentKey });
    parentKey = key;
  }

  // Add two sibling sections at the deepest level
  sections.push({ key: "A", title: "A" });
  sections.push({ key: "B", title: "B" });
  structure.push({ kind: "section", key: "A", parentKey });
  structure.push({ kind: "section", key: "B", parentKey });

  return {
    schemaVersion: "2" as const,
    draftId: `draft.sibling.${depth}`,
    sessionId: `session.sibling.${depth}`,
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
    ],
    sections,
    structure,
    values: { character_name: "Test" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("draft-node-placement (2A4)", () => {
  describe("CONFIRMED GUARD", () => {
    it("confirmed Field move rejected with draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        });
      } catch (e) {
        expect(e).toBeInstanceOf(DraftError);
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("confirmed Section move rejected with draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      const draftWithSections = {
        ...draft,
        sections: [{ key: "X", title: "X" }],
        structure: [
          { kind: "field" as const, key: "character_name", parentKey: null },
          { kind: "section" as const, key: "X", parentKey: null },
          { kind: "field" as const, key: "A", parentKey: null },
        ],
        values: { character_name: "Test", A: "A" },
      };
      expect(() =>
        placeDraftNodeV2(draftWithSections, "X", {
          position: "inside",
          parentKey: null,
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draftWithSections, "X", {
          position: "inside",
          parentKey: null,
        });
      } catch (e) {
        expect(e).toBeInstanceOf(DraftError);
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("confirmed otherwise-valid no-op rejected with draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "after",
          targetKey: "character_name",
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draft, "A", {
          position: "after",
          targetKey: "character_name",
        });
      } catch (e) {
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("confirmed + unknown node still reports draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      expect(() =>
        placeDraftNodeV2(draft, "ghost", {
          position: "before",
          targetKey: "character_name",
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draft, "ghost", {
          position: "before",
          targetKey: "character_name",
        });
      } catch (e) {
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("rejected confirmed operation does not mutate draft", () => {
      const draft = makeConfirmedDraft();
      const originalStructure = JSON.stringify(draft.structure);
      try {
        placeDraftNodeV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        });
      } catch {
        // expected
      }
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });
  });

  describe("FIELD DISPATCH", () => {
    it("Field before Field delegates successfully", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftNodeV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "B", "A"]);
    });

    it("Field after Section delegates successfully", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "after",
        targetKey: "X",
      });
      const keys = result.structure.map((p) => p.key);
      // X is at index 1, after X means index 2 (but X has no children, so after X is before Y)
      expect(keys).toEqual(["character_name", "X", "A", "Y", "B"]);
    });

    it("Field inside Section delegates successfully", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBe("X");
    });

    it("Field back to Root delegates successfully", () => {
      const draft = makeSectionDraft();
      // First move A inside X
      const intermediate = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      // Then move back to root
      const result = placeDraftNodeV2(intermediate, "A", {
        position: "inside",
        parentKey: null,
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBeNull();
    });

    it("Field no-op returns exact original reference", () => {
      const draft = makeSimpleDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      // A is already after character_name
      expect(result).toBe(draft);
    });

    it("successful Field result equals direct placeDraftFieldV2 semantics", () => {
      const draft = makeSectionDraft();
      const result1 = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      const result2 = placeDraftFieldV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      expect(result1).toEqual(result2);
    });

    it("Field movement does not trigger Section depth rejection", () => {
      // Even if Field is at deep structural position, no depth check
      const draft = makeDeepSectionDraft();
      const result = placeDraftNodeV2(draft, "character_name", {
        position: "inside",
        parentKey: "C",
      });
      const namePlacement = result.structure.find(
        (p) => p.key === "character_name",
      );
      expect(namePlacement?.parentKey).toBe("C");
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("SECTION DISPATCH", () => {
    it("Section before sibling delegates successfully", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "before",
        targetKey: "X",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("Section after sibling delegates successfully", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "X", {
        position: "after",
        targetKey: "Y",
      });
      const keys = result.structure.map((p) => p.key);
      expect(keys).toEqual(["character_name", "Y", "X", "A", "B"]);
    });

    it("Section inside another Section delegates successfully", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("X");
    });

    it("Section back to Root delegates successfully", () => {
      const draft = makeSectionDraft();
      const intermediate = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const result = placeDraftNodeV2(intermediate, "Y", {
        position: "inside",
        parentKey: null,
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBeNull();
    });

    it("Section no-op returns exact original reference", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      expect(result).toBe(draft);
    });

    it("successful Section result equals direct placeDraftSectionV2 semantics", () => {
      const draft = makeSectionDraft();
      const result1 = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const result2 = placeDraftSectionV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result1).toEqual(result2);
    });
  });

  describe("DEPTH SAFE", () => {
    it("leaf Section moved to depth 12 allowed", () => {
      // Create chain of depth 11, move leaf to depth 12
      const draft = makeLeafAtDepthDraft(11);
      const result = placeDraftNodeV2(draft, "Leaf", {
        position: "inside",
        parentKey: "S11",
      });
      const leafPlacement = result.structure.find((p) => p.key === "Leaf");
      expect(leafPlacement?.parentKey).toBe("S11");
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("subtree whose deepest Section becomes exactly depth 12 allowed", () => {
      const draft = makeDepthBoundarySafeDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "S9",
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBe("S9");
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("deep subtree moved upward allowed", () => {
      const draft = makeDeepSectionDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: null,
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBeNull();
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("nested Section moved to Root allowed", () => {
      const draft = makeDeepSectionDraft();
      const result = placeDraftNodeV2(draft, "B", {
        position: "inside",
        parentKey: null,
      });
      const bPlacement = result.structure.find((p) => p.key === "B");
      expect(bPlacement?.parentKey).toBeNull();
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("before sibling at deep level calculates sibling depth correctly", () => {
      const draft = makeSiblingAtDepthDraft(10);
      // S10 is at depth 10, A and B are at depth 11
      // Move A before B -> A becomes depth 11 (same as before)
      const result = placeDraftNodeV2(draft, "A", {
        position: "before",
        targetKey: "B",
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBe("S10");
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("after sibling at deep level calculates sibling depth correctly", () => {
      const draft = makeSiblingAtDepthDraft(10);
      const result = placeDraftNodeV2(draft, "B", {
        position: "after",
        targetKey: "A",
      });
      const bPlacement = result.structure.find((p) => p.key === "B");
      expect(bPlacement?.parentKey).toBe("S10");
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("DEPTH REJECTION", () => {
    it("leaf Section projected to depth 13 rejected", () => {
      const draft = makeLeafAtDepthDraft(11);
      // S11 is at depth 11, move Leaf inside S11 -> depth 12
      // Wait, S11 is at depth 11, inside S11 means depth 12. That's allowed.
      // Need depth 12 destination. Let's try depth 12 chain.
      const draft12 = makeLeafAtDepthDraft(12);
      expect(() =>
        placeDraftNodeV2(draft12, "Leaf", {
          position: "inside",
          parentKey: "S12",
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draft12, "Leaf", {
          position: "inside",
          parentKey: "S12",
        });
      } catch (e) {
        expect((e as DraftError).code).toBe("invalid_mutation");
        expect((e as DraftError).message).toContain("exceeds maximum");
      }
    });

    it("moved root stays <=12 but descendant reaches 13 -> rejected", () => {
      const draft = makeDepthBoundaryDraft();
      // S10 is at depth 10
      // Moving A (relative depth 2) inside S10 -> A at 11, C at 13 -> REJECT
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        }),
      ).toThrowError(DraftError);
      try {
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        });
      } catch (e) {
        expect((e as DraftError).code).toBe("invalid_mutation");
        expect((e as DraftError).message).toContain("exceeds maximum");
      }
    });

    it("multi-level subtree descendant overflow rejected", () => {
      const draft = makeDepthBoundaryDraft();
      // Same as above - A->B->C with C reaching 13
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        }),
      ).toThrowError(DraftError);
    });

    it("overflow via inside Section rejected", () => {
      const draft = makeDepthBoundaryDraft();
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        }),
      ).toThrowError(DraftError);
    });

    it("rejected depth move does not mutate input", () => {
      const draft = makeDepthBoundaryDraft();
      const originalStructure = JSON.stringify(draft.structure);
      try {
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        });
      } catch {
        // expected
      }
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });

    it("rejected depth move does not invoke a partial structural mutation", () => {
      const draft = makeDepthBoundaryDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      try {
        placeDraftNodeV2(draft, "A", {
          position: "inside",
          parentKey: "S10",
        });
      } catch {
        // expected
      }
      // Draft should be completely unchanged
      expect(draft).toEqual(originalDraft);
    });
  });

  describe("DESTINATION SEMANTICS", () => {
    it("before target uses target parent depth, not target+1", () => {
      // S10 at depth 10, A and B at depth 11 (children of S10)
      const draft = makeSiblingAtDepthDraft(10);
      // Move A before B - A should remain at depth 11 (sibling of B)
      const result = placeDraftNodeV2(draft, "A", {
        position: "before",
        targetKey: "B",
      });
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.parentKey).toBe("S10");
    });

    it("after target uses target parent depth, not target+1", () => {
      const draft = makeSiblingAtDepthDraft(10);
      const result = placeDraftNodeV2(draft, "B", {
        position: "after",
        targetKey: "A",
      });
      const bPlacement = result.structure.find((p) => p.key === "B");
      expect(bPlacement?.parentKey).toBe("S10");
    });

    it("before Root target results projected root depth 0", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "X", {
        position: "before",
        targetKey: "character_name",
      });
      const xPlacement = result.structure.find((p) => p.key === "X");
      expect(xPlacement?.parentKey).toBeNull();
    });

    it("after Root target results projected root depth 0", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "X", {
        position: "after",
        targetKey: "character_name",
      });
      const xPlacement = result.structure.find((p) => p.key === "X");
      expect(xPlacement?.parentKey).toBeNull();
    });

    it("inside parent uses parent depth + 1", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.parentKey).toBe("X");
    });
  });

  describe("INVALID CASES (inherited from planner/primitives)", () => {
    it("unknown node rejected invalid_mutation", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "ghost", {
          position: "before",
          targetKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown before target rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "before",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown after target rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "after",
          targetKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("unknown inside parent rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "inside",
          parentKey: "ghost",
        }),
      ).toThrowError(DraftError);
    });

    it("inside parent is Field rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "inside",
          parentKey: "A",
        }),
      ).toThrowError(DraftError);
    });

    it("Field before itself rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        placeDraftNodeV2(draft, "A", {
          position: "before",
          targetKey: "A",
        }),
      ).toThrowError(DraftError);
    });

    it("Section before itself rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "before",
          targetKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside itself rejected", () => {
      const draft = makeSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "X", {
          position: "inside",
          parentKey: "X",
        }),
      ).toThrowError(DraftError);
    });

    it("Section inside descendant rejected", () => {
      const draft = makeDeepSectionDraft();
      expect(() =>
        placeDraftNodeV2(draft, "Root", {
          position: "inside",
          parentKey: "A",
        }),
      ).toThrowError(DraftError);
    });
  });

  describe("CONSISTENCY", () => {
    it("successful Field result passes validateDraftV2", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("successful Section result passes validateDraftV2", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("all unrelated content registries remain unchanged", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.fields).toEqual(draft.fields);
      expect(result.sections).toEqual(draft.sections);
      expect(result.values).toEqual(draft.values);
    });

    it("version unchanged", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.version).toBe(draft.version);
      expect(result.baseVersion).toBe(draft.baseVersion);
    });

    it("baseVersion unchanged", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.baseVersion).toBe(draft.baseVersion);
    });

    it("source/metadata unchanged", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.source).toEqual(draft.source);
      expect(result.draftId).toBe(draft.draftId);
      expect(result.sessionId).toBe(draft.sessionId);
      expect(result.mode).toBe(draft.mode);
      expect(result.rulesContextId).toBe(draft.rulesContextId);
      expect(result.characterName).toBe(draft.characterName);
      expect(result.confirmed).toBe(draft.confirmed);
    });

    it("structure[] remains sole structural authority", () => {
      const draft = makeSectionDraft();
      const result = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      // The structure array should be the only thing that changed
      const originalKeys = Object.keys(draft).filter((k) => k !== "structure");
      const resultKeys = Object.keys(result).filter((k) => k !== "structure");
      expect(originalKeys).toEqual(resultKeys);
      for (const key of originalKeys) {
        if (key !== "structure") {
          expect(result[key as keyof CharacterSheetDraftV2]).toEqual(
            draft[key as keyof CharacterSheetDraftV2],
          );
        }
      }
    });
  });
});
