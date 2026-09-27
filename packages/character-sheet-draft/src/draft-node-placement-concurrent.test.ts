import { describe, expect, it } from "vitest";
import { applyDraftNodePlacementWithExpectedVersionV2 } from "./draft-node-placement-concurrent";
import { applyDraftNodePlacementV2 } from "./draft-node-placement-versioned";
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

describe("draft-node-placement-concurrent (2B2)", () => {
  describe("MATCHING VERSION - ALLOWS PLACEMENT", () => {
    it("matching expectedVersion allows Field move", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "B",
        {
          position: "before",
          targetKey: "A",
        },
        1,
      );
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("matching expectedVersion allows Section move", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "Y",
        {
          position: "inside",
          parentKey: "X",
        },
        1,
      );
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("successful Field move increments version exactly once", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "B",
        {
          position: "before",
          targetKey: "A",
        },
        1,
      );
      expect(result.version).toBe(2);
    });

    it("successful Section move increments version exactly once", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "Y",
        {
          position: "inside",
          parentKey: "X",
        },
        1,
      );
      expect(result.version).toBe(2);
    });

    it("baseVersion remains unchanged", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "B",
        {
          position: "before",
          targetKey: "A",
        },
        5,
      );
      expect(result.baseVersion).toBe(3);
      expect(result.version).toBe(6);
    });

    it("structural result matches 2B1 semantics", () => {
      const draft = makeSectionDraft();
      const result1 = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "Y",
        {
          position: "inside",
          parentKey: "X",
        },
        1,
      );
      const result2 = applyDraftNodePlacementV2(draft, "Y", {
        position: "inside",
        parentKey: "X",
      });
      expect(result1.structure).toEqual(result2.structure);
      expect(result1.version).toBe(result2.version);
    });

    it("successful result passes V2 validation", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "Y",
        {
          position: "inside",
          parentKey: "X",
        },
        1,
      );
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("VERSION MISMATCH - REJECTS", () => {
    it("expectedVersion lower than current rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          0,
        ),
      ).toThrowError(DraftError);
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
        expect((e as DraftError).message).toContain(
          "Expected version 0 but draft is at version 1",
        );
      }
    });

    it("expectedVersion higher than current rejected", () => {
      const draft = makeSimpleDraft();
      expect(() =>
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          2,
        ),
      ).toThrowError(DraftError);
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          2,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
        expect((e as DraftError).message).toContain(
          "Expected version 2 but draft is at version 1",
        );
      }
    });

    it("mismatch returns correct existing version-conflict error", () => {
      const draft = makeSimpleDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          99,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });

    it("mismatch does not bump version", () => {
      const draft = makeSimpleDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          2,
        );
      } catch {
        // expected
      }
      expect(draft.version).toBe(1);
    });

    it("mismatch does not change baseVersion", () => {
      const draft = makeVersionedDraft(5, 3);
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "B",
          {
            position: "before",
            targetKey: "A",
          },
          4,
        );
      } catch {
        // expected
      }
      expect(draft.baseVersion).toBe(3);
      expect(draft.version).toBe(5);
    });

    it("mismatch does not mutate structure", () => {
      const draft = makeSectionDraft();
      const originalStructure = JSON.stringify(draft.structure);
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "Y",
          {
            position: "inside",
            parentKey: "X",
          },
          2,
        );
      } catch {
        // expected
      }
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });

    it("mismatch does not mutate complete input draft", () => {
      const draft = makeSectionDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "Y",
          {
            position: "inside",
            parentKey: "X",
          },
          2,
        );
      } catch {
        // expected
      }
      expect(draft).toEqual(originalDraft);
    });
  });

  describe("ERROR PRECEDENCE - VERSION CHECK FIRST", () => {
    it("stale + confirmed -> version conflict", () => {
      const draft = makeConfirmedDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "A",
          {
            position: "before",
            targetKey: "character_name",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });

    it("stale + unknown node -> version conflict", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "ghost",
          {
            position: "before",
            targetKey: "X",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });

    it("stale + invalid target -> version conflict", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "X",
          {
            position: "before",
            targetKey: "ghost",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });

    it("stale + depth-overflow move -> version conflict", () => {
      // Create a deep destination chain
      const deepDraft: CharacterSheetDraftV2 = {
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
        ],
        structure: [
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
          { kind: "section" as const, key: "A", parentKey: null },
          { kind: "section" as const, key: "B", parentKey: "A" },
          { kind: "section" as const, key: "C", parentKey: "B" },
        ],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          deepDraft,
          "A",
          {
            position: "inside",
            parentKey: "S10",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });

    it("stale + would-be no-op -> version conflict", () => {
      const draft = makeSectionDraft();
      // X before Y is a no-op
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "X",
          {
            position: "before",
            targetKey: "Y",
          },
          0,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("version_conflict");
      }
    });
  });

  describe("MATCHED VERSION - LOWER ERRORS PROPAGATED", () => {
    it("confirmed draft -> draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "A",
          {
            position: "before",
            targetKey: "character_name",
          },
          1,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("draft_confirmed");
      }
    });

    it("unknown node -> existing invalid_mutation", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "ghost",
          {
            position: "before",
            targetKey: "X",
          },
          1,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("invalid target -> existing invalid_mutation", () => {
      const draft = makeSectionDraft();
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "X",
          {
            position: "before",
            targetKey: "ghost",
          },
          1,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("depth overflow -> existing invalid_mutation", () => {
      const deepDraft: CharacterSheetDraftV2 = {
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
        ],
        structure: [
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
          { kind: "section" as const, key: "A", parentKey: null },
          { kind: "section" as const, key: "B", parentKey: "A" },
          { kind: "section" as const, key: "C", parentKey: "B" },
        ],
        values: { character_name: "Test" },
        source: { sourceSheetId: null, sourceRunId: null },
        confirmed: false,
      };
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          deepDraft,
          "A",
          {
            position: "inside",
            parentKey: "S10",
          },
          1,
        );
      } catch (e) {
        expect((e as DraftError).code).toBe("invalid_mutation");
        expect((e as DraftError).message).toContain("exceeds maximum");
      }
    });
  });

  describe("NO-OP WITH MATCHING VERSION", () => {
    it("matching version + Field no-op returns exact original reference", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "A",
        {
          position: "after",
          targetKey: "character_name",
        },
        1,
      );
      expect(result).toBe(draft);
    });

    it("matching version + Field no-op does not bump version", () => {
      const draft = makeSimpleDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "A",
        {
          position: "after",
          targetKey: "character_name",
        },
        1,
      );
      expect(result.version).toBe(1);
      expect(result.baseVersion).toBe(1);
    });

    it("matching version + Section no-op returns exact original reference", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "X",
        {
          position: "before",
          targetKey: "Y",
        },
        1,
      );
      expect(result).toBe(draft);
    });

    it("matching version + Section no-op does not bump version", () => {
      const draft = makeSectionDraft();
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "X",
        {
          position: "before",
          targetKey: "Y",
        },
        1,
      );
      expect(result.version).toBe(1);
      expect(result.baseVersion).toBe(1);
    });

    it("baseVersion unchanged on no-op", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "A",
        {
          position: "after",
          targetKey: "character_name",
        },
        5,
      );
      expect(result.baseVersion).toBe(3);
      expect(result.version).toBe(5);
    });
  });

  describe("IMMUTABILITY", () => {
    it("input draft unchanged on successful move", () => {
      const draft = makeSectionDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        "Y",
        {
          position: "inside",
          parentKey: "X",
        },
        1,
      );
      expect(draft).toEqual(originalDraft);
    });

    it("rejected input unchanged on version mismatch", () => {
      const draft = makeSectionDraft();
      const originalDraft = JSON.parse(JSON.stringify(draft));
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "Y",
          {
            position: "inside",
            parentKey: "X",
          },
          2,
        );
      } catch {
        // expected
      }
      expect(draft).toEqual(originalDraft);
    });

    it("version check fails before structural evaluation", () => {
      const draft = makeSectionDraft();
      const originalStructure = JSON.stringify(draft.structure);
      try {
        applyDraftNodePlacementWithExpectedVersionV2(
          draft,
          "Y",
          {
            position: "inside",
            parentKey: "X",
          },
          2,
        );
      } catch {
        // expected
      }
      expect(JSON.stringify(draft.structure)).toBe(originalStructure);
    });
  });
});
