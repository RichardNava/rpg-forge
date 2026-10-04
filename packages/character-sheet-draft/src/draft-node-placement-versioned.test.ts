import { describe, expect, it } from "vitest";
import { applyDraftNodePlacementV2 } from "./draft-node-placement-versioned";
import { placeDraftNodeV2 } from "./draft-node-placement";
import { validateDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import { type DraftNodeDestination } from "./draft-structure-placement-plan";

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

function makeNestedDraft(): CharacterSheetDraftV2 {
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

function makeVersionedDraft(
  version: number,
  baseVersion: number,
): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.versioned",
    sessionId: "session.versioned",
    baseVersion,
    version,
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

describe("draft-node-placement-versioned (2B1)", () => {
  describe("SUCCESSFUL FIELD MOVE - VERSION BUMP", () => {
    it("successful Field move increments version exactly once", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("Field reparent increments version exactly once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("move to Root increments version exactly once", () => {
      const draft = makeSectionDraft();
      // First move A inside X
      const intermediate = applyDraftNodePlacementV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      // Then move back to root
      const result = applyDraftNodePlacementV2(intermediate, "A", {
        position: "inside",
        parentKey: null,
      });
      expect(result.version).toBe(3); // 1 -> 2 -> 3
      expect(result.baseVersion).toBe(1);
    });

    it("before move increments once", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      expect(result.version).toBe(2);
    });

    it("after move increments once", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "after",
        targetKey: "B",
      });
      expect(result.version).toBe(2);
    });

    it("inside move increments once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.version).toBe(2);
    });
  });

  describe("SUCCESSFUL SECTION MOVE - VERSION BUMP", () => {
    it("successful Section move increments version exactly once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "before",
        targetKey: "X",
      });
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("Section reparent increments version exactly once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("move to Root increments version exactly once", () => {
      const draft = makeSectionDraft();
      const intermediate = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const result = applyDraftNodePlacementV2(intermediate, "Y", {
        position: "inside",
        parentKey: null,
      });
      expect(result.version).toBe(3);
      expect(result.baseVersion).toBe(1);
    });

    it("before move increments once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "before",
        targetKey: "X",
      });
      expect(result.version).toBe(2);
    });

    it("after move increments once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "X", {
        position: "after",
        targetKey: "Y",
      });
      expect(result.version).toBe(2);
    });

    it("inside move increments once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.version).toBe(2);
    });
  });

  describe("NO-OP SEMANTICS", () => {
    it("Field no-op returns exact original reference", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      expect(result).toBe(draft);
    });

    it("Field no-op does not bump version", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      expect(result.version).toBe(1);
      expect(result.baseVersion).toBe(1);
    });

    it("Section no-op returns exact original reference", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      expect(result).toBe(draft);
    });

    it("Section no-op does not bump version", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      expect(result.version).toBe(1);
      expect(result.baseVersion).toBe(1);
    });

    it("baseVersion unchanged on real change", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = applyDraftNodePlacementV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      expect(result.baseVersion).toBe(3);
      expect(result.version).toBe(6);
    });

    it("baseVersion unchanged on no-op", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = applyDraftNodePlacementV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      expect(result.baseVersion).toBe(3);
      expect(result.version).toBe(5);
    });

    it("all unrelated metadata unchanged", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result.draftId).toBe(draft.draftId);
      expect(result.sessionId).toBe(draft.sessionId);
      expect(result.mode).toBe(draft.mode);
      expect(result.rulesContextId).toBe(draft.rulesContextId);
      expect(result.characterName).toBe(draft.characterName);
      expect(result.confirmed).toBe(draft.confirmed);
      expect(result.source).toEqual(draft.source);
      expect(result.fields).toEqual(draft.fields);
      expect(result.sections).toEqual(draft.sections);
      expect(result.values).toEqual(draft.values);
    });
  });

  describe("REJECTIONS", () => {
    it("confirmed move rejected with draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      expect(() =>
        applyDraftNodePlacementV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        }),
      ).toThrowError(DraftError);
      try {
        applyDraftNodePlacementV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        });
      } catch (e) {
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("confirmed rejection leaves version unchanged", () => {
      const draft = makeConfirmedDraft();
      try {
        applyDraftNodePlacementV2(draft, "A", {
          position: "before",
          targetKey: "character_name",
        });
      } catch {
        // expected
      }
      expect(draft.version).toBe(1);
    });

    it("invalid target rejection leaves version unchanged", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementV2(draft, "X", {
          position: "before",
          targetKey: "ghost",
        });
      } catch {
        // expected
      }
      expect(draft.version).toBe(1);
    });

    it("depth overflow rejection leaves version unchanged", () => {
      const draft = makeNestedDraft();
      // Create a deep destination
      const deepDraft: CharacterSheetDraftV2 = {
        ...draft,
        sections: [
          ...draft.sections,
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
        ],
        structure: [
          ...draft.structure,
          { kind: "section" as const, key: "S1", parentKey: null },
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
        ],
        fields: [
          ...draft.fields,
          { key: "A", label: "A", type: "text" as const, locked: false },
          { key: "B", label: "B", type: "text" as const, locked: false },
          { key: "C", label: "C", type: "text" as const, locked: false },
        ],
        values: { ...draft.values, A: "A", B: "B", C: "C" },
      };
      try {
        applyDraftNodePlacementV2(deepDraft, "A", {
          position: "inside",
          parentKey: "S10",
        });
      } catch {
        // expected
      }
      expect(deepDraft.version).toBe(1);
    });

    it("unknown node rejection leaves version unchanged", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementV2(draft, "ghost", {
          position: "before",
          targetKey: "X",
        });
      } catch {
        // expected
      }
      expect(draft.version).toBe(1);
    });
  });

  describe("IMMUTABILITY", () => {
    it("input draft remains deep-equal after successful move", () => {
      const draft = makeSectionDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(draft).toEqual(originalDraft);
    });

    it("input version unchanged after successful move", () => {
      const draft = makeVersionedDraft(5, 3);
      applyDraftNodePlacementV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      expect(draft.version).toBe(5);
    });

    it("rejected input unchanged", () => {
      const draft = makeSectionDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      try {
        applyDraftNodePlacementV2(draft, "X", {
          position: "before",
          targetKey: "ghost",
        });
      } catch {
        // expected
      }
      expect(draft).toEqual(originalDraft);
    });
  });

  describe("VALIDATION", () => {
    it("successful Field result passes V2 validation", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementV2(draft, "B", {
        position: "before",
        targetKey: "A",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("successful Section result passes V2 validation", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("STRUCTURAL SEMANTICS MATCH PLACED", () => {
    it("successful Field result structure matches placeDraftNodeV2", () => {
      const draft = makeSectionDraft();
      const result1 = applyDraftNodePlacementV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      const result2 = placeDraftNodeV2(draft, "A", {
        position: "inside",
        parentKey: "X",
      });
      expect(result1.structure).toEqual(result2.structure);
      expect(result1.version).toBe(result2.version + 1);
    });

    it("successful Section result structure matches placeDraftNodeV2", () => {
      const draft = makeSectionDraft();
      const result1 = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      const result2 = placeDraftNodeV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result1.structure).toEqual(result2.structure);
      expect(result1.version).toBe(result2.version + 1);
    });

    it("no-op Field structure identical to placeDraftNodeV2", () => {
      const draft = makeSimpleDraft();
      const result1 = applyDraftNodePlacementV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      const result2 = placeDraftNodeV2(draft, "A", {
        position: "after",
        targetKey: "character_name",
      });
      expect(result1).toBe(result2);
      expect(result1.structure).toEqual(result2.structure);
    });

    it("no-op Section structure identical to placeDraftNodeV2", () => {
      const draft = makeSectionDraft();
      const result1 = applyDraftNodePlacementV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      const result2 = placeDraftNodeV2(draft, "X", {
        position: "before",
        targetKey: "Y",
      });
      expect(result1).toBe(result2);
      expect(result1.structure).toEqual(result2.structure);
    });
  });
});

describe("place_node layout geometry preservation (14.8)", () => {
  function makeLayoutDraft(): CharacterSheetDraftV2 {
    return {
      schemaVersion: "2" as const,
      draftId: "draft.place-layout",
      sessionId: "session.place-layout",
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
      sections: [
        { key: "wide", title: "Wide" },
        { key: "narrow", title: "Narrow" },
      ],
      structure: [
        { kind: "field" as const, key: "character_name", parentKey: null },
        { kind: "section" as const, key: "wide", parentKey: null },
        { kind: "section" as const, key: "narrow", parentKey: null },
        { kind: "field" as const, key: "A", parentKey: null },
      ],
      values: { character_name: "Test", A: "A" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { wide: { columns: 2 }, narrow: { columns: 1 } },
        nodes: {
          character_name: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          wide: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          narrow: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          A: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
      },
    };
  }

  function draftErrorCodeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      return (error as DraftError).code;
    }
    return "none";
  }

  it("preserves valid geometry when moving within fitting containers", () => {
    const draft = makeLayoutDraft();
    // A sits at column 2 of the 2-column Root; moving it inside the 2-column
    // wide section keeps its geometry valid.
    const result = applyDraftNodePlacementV2(draft, "A", {
      position: "inside",
      parentKey: "wide",
    });
    expect(result).not.toBe(draft);
    expect(result.layout?.nodes["A"]).toEqual(draft.layout?.nodes["A"]);
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("rejects a move whose preserved geometry no longer fits", () => {
    const draft = makeLayoutDraft();
    // A sits at column 2; the narrow section has a single column, so the
    // preserved geometry cannot fit and the move must reject, never clamp.
    expect(
      draftErrorCodeOf(() =>
        applyDraftNodePlacementV2(draft, "A", {
          position: "inside",
          parentKey: "narrow",
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("moves freely when the draft is layoutless", () => {
    const draft = makeLayoutDraft();
    const { layout: _layout, ...layoutless } = draft;
    const result = applyDraftNodePlacementV2(layoutless, "A", {
      position: "inside",
      parentKey: "narrow",
    });
    expect(result.layout).toBeUndefined();
    expect(result.structure.find((entry) => entry.key === "A")?.parentKey).toBe(
      "narrow",
    );
  });
});
