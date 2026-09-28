import { describe, expect, it } from "vitest";
import {
  applyDraftMutationV2,
  DraftMutationV2Schema,
  parseDraftMutationV2,
} from "./draft-mutation-v2";
import type {
  DraftMutationV2,
  DraftPlaceNodeMutationV2,
} from "./draft-mutation-v2";
import {
  draftKeyPattern,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { applyDraftNodePlacementWithExpectedVersionV2 } from "./draft-node-placement-concurrent";
import { DraftError } from "./errors";

describe("draft-mutation-v2 schema — BLOCK A", () => {
  describe("valid payloads", () => {
    it("accepts a before payload", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an after payload", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an inside Section payload", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "A",
        destination: { position: "inside", parentKey: "skills" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an inside Root payload (parentKey null)", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "A",
        destination: { position: "inside", parentKey: null },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid payloads", () => {
    it("rejects an unknown op", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "remove_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a missing key", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        destination: { position: "after", targetKey: "B" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid key syntax", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "bad key!",
        destination: { position: "after", targetKey: "B" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an extra top-level property", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it("rejects expectedVersion inside the mutation payload", () => {
      const result = DraftMutationV2Schema.safeParse({
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
        expectedVersion: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("draftKeyPattern regression", () => {
    it("exports draftKeyPattern as a RegExp", () => {
      expect(draftKeyPattern).toBeInstanceOf(RegExp);
    });

    it("DraftMutationV2Schema.safeParse does not reproduce the lastIndex exception", () => {
      expect(() => {
        const result = DraftMutationV2Schema.safeParse({
          op: "place_node",
          key: "B",
          destination: { position: "before", targetKey: "A" },
        });
        expect(result.success).toBe(true);
      }).not.toThrow();
    });
  });
});

describe("draft-mutation-v2 parser — BLOCK B", () => {
  describe("valid payloads parse", () => {
    it("parses a valid before payload", () => {
      const mutation = parseDraftMutationV2({
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      });
      expect(mutation.op).toBe("place_node");
      if (mutation.op !== "place_node") {
        throw new Error("unreachable");
      }
      expect(mutation.key).toBe("B");
      expect(mutation.destination).toEqual({
        position: "before",
        targetKey: "A",
      });
    });

    it("parses a valid after payload", () => {
      const mutation = parseDraftMutationV2({
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
      });
      expect(mutation.op).toBe("place_node");
      if (mutation.op !== "place_node") {
        throw new Error("unreachable");
      }
      expect(mutation.destination).toEqual({
        position: "after",
        targetKey: "B",
      });
    });

    it("parses a valid inside Section payload", () => {
      const mutation = parseDraftMutationV2({
        op: "place_node",
        key: "A",
        destination: { position: "inside", parentKey: "skills" },
      });
      expect(mutation.op).toBe("place_node");
      if (mutation.op !== "place_node") {
        throw new Error("unreachable");
      }
      expect(mutation.destination).toEqual({
        position: "inside",
        parentKey: "skills",
      });
    });

    it("parses a valid inside Root payload", () => {
      const mutation = parseDraftMutationV2({
        op: "place_node",
        key: "A",
        destination: { position: "inside", parentKey: null },
      });
      expect(mutation.op).toBe("place_node");
      if (mutation.op !== "place_node") {
        throw new Error("unreachable");
      }
      expect(mutation.destination).toEqual({
        position: "inside",
        parentKey: null,
      });
    });
  });

  describe("invalid payloads throw DraftError with invalid_mutation", () => {
    it("throws DraftError for invalid unknown input", () => {
      expect(() => parseDraftMutationV2(null)).toThrow(DraftError);
    });

    it("invalid payload error code is invalid_mutation", () => {
      try {
        parseDraftMutationV2({ op: "nope", key: "A" });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("missing op through parser → invalid_mutation", () => {
      try {
        parseDraftMutationV2({
          key: "A",
          destination: { position: "after", targetKey: "B" },
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("invalid key through parser → invalid_mutation", () => {
      try {
        parseDraftMutationV2({
          op: "place_node",
          key: "bad key!",
          destination: { position: "after", targetKey: "B" },
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("malformed destination through parser → invalid_mutation", () => {
      try {
        parseDraftMutationV2({
          op: "place_node",
          key: "A",
          destination: { position: "sideways", targetKey: "B" },
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("extra top-level property through parser → invalid_mutation", () => {
      try {
        parseDraftMutationV2({
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "B" },
          extra: true,
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });

    it("expectedVersion inside mutation payload → invalid_mutation", () => {
      try {
        parseDraftMutationV2({
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "B" },
          expectedVersion: 1,
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    });
  });

  describe("parser does not mutate input", () => {
    it("does not mutate valid input", () => {
      const input = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const snapshot = JSON.stringify(input);
      parseDraftMutationV2(input);
      expect(JSON.stringify(input)).toBe(snapshot);
    });

    it("does not mutate invalid input", () => {
      const input = {
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
        expectedVersion: 1,
      };
      const snapshot = JSON.stringify(input);
      try {
        parseDraftMutationV2(input);
      } catch {
        // expected
      }
      expect(JSON.stringify(input)).toBe(snapshot);
    });
  });
});

function makeFieldDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.fields",
    sessionId: "session.fields",
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

function makeVersionedSectionDraft(
  version: number,
  baseVersion: number,
): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.versioned.sections",
    sessionId: "session.versioned.sections",
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

function makeNestedSectionDraft(): CharacterSheetDraftV2 {
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
      { key: "B", label: "B", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "X", title: "X" },
      { key: "Y", title: "Y" },
      { key: "X1", title: "X1" },
      { key: "X2", title: "X2" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "section" as const, key: "X1", parentKey: "X" },
      { kind: "section" as const, key: "X2", parentKey: "X" },
      { kind: "section" as const, key: "Y", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "field" as const, key: "B", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", B: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function mutate(
  draft: CharacterSheetDraftV2,
  mutation: DraftMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  return applyDraftMutationV2(draft, mutation, expectedVersion);
}

describe("draft-mutation-v2 application — BLOCK C", () => {
  describe("successful Field application", () => {
    it("place_node Field with before", () => {
      const draft = makeFieldDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "B",
          destination: { position: "before", targetKey: "A" },
        },
        1,
      );
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "B",
        "A",
      ]);
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("place_node Field with after", () => {
      const draft = makeFieldDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "B" },
        },
        1,
      );
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "B",
        "A",
      ]);
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("place_node Field with inside Section", () => {
      const draft = makeSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "inside", parentKey: "X" },
        },
        1,
      );
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.kind).toBe("field");
      expect(aPlacement?.parentKey).toBe("X");
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "X",
        "A",
        "Y",
        "B",
      ]);
    });

    it("place_node Field with inside Root", () => {
      const draft = makeFieldDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "inside", parentKey: null },
        },
        1,
      );
      const aPlacement = result.structure.find((p) => p.key === "A");
      expect(aPlacement?.kind).toBe("field");
      expect(aPlacement?.parentKey).toBeNull();
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "B",
        "A",
      ]);
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });
  });

  describe("successful Section application", () => {
    it("place_node Section with before", () => {
      const draft = makeNestedSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "Y",
          destination: { position: "before", targetKey: "X" },
        },
        1,
      );
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "Y",
        "X",
        "X1",
        "X2",
        "A",
        "B",
      ]);
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("place_node Section with after moves complete subtree", () => {
      const draft = makeNestedSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "after", targetKey: "Y" },
        },
        1,
      );
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "Y",
        "X",
        "X1",
        "X2",
        "A",
        "B",
      ]);
      const x1 = result.structure.find((p) => p.key === "X1");
      const x2 = result.structure.find((p) => p.key === "X2");
      expect(x1?.parentKey).toBe("X");
      expect(x2?.parentKey).toBe("X");
      const x = result.structure.find((p) => p.key === "X");
      expect(x?.parentKey).toBeNull();
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("place_node Section with inside another Section", () => {
      const draft = makeSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "Y",
          destination: { position: "inside", parentKey: "X" },
        },
        1,
      );
      const yPlacement = result.structure.find((p) => p.key === "Y");
      expect(yPlacement?.kind).toBe("section");
      expect(yPlacement?.parentKey).toBe("X");
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "X",
        "Y",
        "A",
        "B",
      ]);
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });

    it("place_node Section with inside Root", () => {
      const draft = makeNestedSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "inside", parentKey: null },
        },
        1,
      );
      expect(result.structure.map((p) => p.key)).toEqual([
        "character_name",
        "Y",
        "A",
        "B",
        "X",
        "X1",
        "X2",
      ]);
      const x = result.structure.find((p) => p.key === "X");
      expect(x?.parentKey).toBeNull();
      const x1 = result.structure.find((p) => p.key === "X1");
      expect(x1?.parentKey).toBe("X");
      expect(result.version).toBe(2);
      expect(result.baseVersion).toBe(1);
    });
  });

  describe("V2 validation of results", () => {
    it("successful Field mutation result passes V2 validation", () => {
      const draft = makeFieldDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "B",
          destination: { position: "before", targetKey: "A" },
        },
        1,
      );
      expect(() => validateDraftV2(result)).not.toThrow();
    });

    it("successful Section mutation result passes V2 validation", () => {
      const draft = makeNestedSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "after", targetKey: "Y" },
        },
        1,
      );
      expect(() => validateDraftV2(result)).not.toThrow();
    });
  });

  describe("Field no-op", () => {
    it("matching-version Field no-op returns exact original draft reference", () => {
      const draft = makeFieldDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "character_name" },
        },
        1,
      );
      expect(result).toBe(draft);
    });

    it("Field no-op does not bump version", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "character_name" },
        },
        5,
      );
      expect(result.version).toBe(5);
    });

    it("Field no-op keeps baseVersion unchanged", () => {
      const draft = makeVersionedDraft(5, 3);
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "A",
          destination: { position: "after", targetKey: "character_name" },
        },
        5,
      );
      expect(result.baseVersion).toBe(3);
    });
  });

  describe("Section no-op", () => {
    it("matching-version Section no-op returns exact original draft reference", () => {
      const draft = makeSectionDraft();
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "before", targetKey: "Y" },
        },
        1,
      );
      expect(result).toBe(draft);
    });

    it("Section no-op does not bump version", () => {
      const draft = makeVersionedSectionDraft(5, 3);
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "before", targetKey: "Y" },
        },
        5,
      );
      expect(result.version).toBe(5);
    });

    it("Section no-op keeps baseVersion unchanged", () => {
      const draft = makeVersionedSectionDraft(5, 3);
      const result = mutate(
        draft,
        {
          op: "place_node",
          key: "X",
          destination: { position: "before", targetKey: "Y" },
        },
        5,
      );
      expect(result.baseVersion).toBe(3);
    });
  });
});

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

function makeDeepDraft(): CharacterSheetDraftV2 {
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
}

function direct2B2(
  draft: CharacterSheetDraftV2,
  mutation: DraftPlaceNodeMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  return applyDraftNodePlacementWithExpectedVersionV2(
    draft,
    mutation.key,
    mutation.destination,
    expectedVersion,
  );
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("draft-mutation-v2 — BLOCK D", () => {
  describe("concurrency — version conflict", () => {
    it("expectedVersion lower than draft.version → version_conflict", () => {
      const draft = makeVersionedDraft(5, 3);
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "after", targetKey: "B" },
          },
          4,
        ),
      );
      expect(code).toBe("version_conflict");
    });

    it("expectedVersion higher than draft.version → version_conflict", () => {
      const draft = makeVersionedDraft(5, 3);
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "after", targetKey: "B" },
          },
          6,
        ),
      );
      expect(code).toBe("version_conflict");
    });

    it("version conflict leaves draft unchanged", () => {
      const draft = makeSectionDraft();
      const original = JSON.parse(JSON.stringify(draft));
      try {
        mutate(
          draft,
          {
            op: "place_node",
            key: "Y",
            destination: { position: "inside", parentKey: "X" },
          },
          2,
        );
      } catch {
        // expected
      }
      expect(draft).toEqual(original);
    });

    it("version conflict leaves version unchanged", () => {
      const draft = makeVersionedDraft(5, 3);
      try {
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "after", targetKey: "B" },
          },
          6,
        );
      } catch {
        // expected
      }
      expect(draft.version).toBe(5);
    });

    it("version conflict leaves baseVersion unchanged", () => {
      const draft = makeVersionedDraft(5, 3);
      try {
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "after", targetKey: "B" },
          },
          6,
        );
      } catch {
        // expected
      }
      expect(draft.baseVersion).toBe(3);
    });
  });

  describe("error precedence — stale version", () => {
    it("stale + confirmed → version_conflict", () => {
      const draft = makeConfirmedDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "before", targetKey: "character_name" },
          },
          0,
        ),
      );
      expect(code).toBe("version_conflict");
    });

    it("stale + unknown node → version_conflict", () => {
      const draft = makeSectionDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "ghost",
            destination: { position: "before", targetKey: "X" },
          },
          0,
        ),
      );
      expect(code).toBe("version_conflict");
    });

    it("stale + invalid target → version_conflict", () => {
      const draft = makeSectionDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "X",
            destination: { position: "before", targetKey: "ghost" },
          },
          0,
        ),
      );
      expect(code).toBe("version_conflict");
    });

    it("stale + would-be no-op → version_conflict", () => {
      const draft = makeSectionDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "X",
            destination: { position: "before", targetKey: "Y" },
          },
          0,
        ),
      );
      expect(code).toBe("version_conflict");
    });
  });

  describe("error precedence — matching version", () => {
    it("confirmed draft → draft_confirmed", () => {
      const draft = makeConfirmedDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "before", targetKey: "character_name" },
          },
          1,
        ),
      );
      expect(code).toBe("draft_confirmed");
    });

    it("unknown node → invalid_mutation", () => {
      const draft = makeSectionDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "ghost",
            destination: { position: "before", targetKey: "X" },
          },
          1,
        ),
      );
      expect(code).toBe("invalid_mutation");
    });

    it("invalid target → invalid_mutation", () => {
      const draft = makeSectionDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "X",
            destination: { position: "before", targetKey: "ghost" },
          },
          1,
        ),
      );
      expect(code).toBe("invalid_mutation");
    });

    it("depth overflow → invalid_mutation", () => {
      const draft = makeDeepDraft();
      const code = errorCodeOf(() =>
        mutate(
          draft,
          {
            op: "place_node",
            key: "A",
            destination: { position: "inside", parentKey: "S10" },
          },
          1,
        ),
      );
      expect(code).toBe("invalid_mutation");
    });
  });

  describe("equivalence with direct 2B2 invocation", () => {
    it("Field move equivalent", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const viaDispatcher = mutate(draft, mutation, 1);
      const viaDirect = direct2B2(draft, mutation, 1);
      expect(viaDispatcher.structure).toEqual(viaDirect.structure);
      expect(viaDispatcher.version).toBe(viaDirect.version);
      expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
    });

    it("Section move equivalent", () => {
      const draft = makeNestedSectionDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "X",
        destination: { position: "after", targetKey: "Y" },
      };
      const viaDispatcher = mutate(draft, mutation, 1);
      const viaDirect = direct2B2(draft, mutation, 1);
      expect(viaDispatcher.structure).toEqual(viaDirect.structure);
      expect(viaDispatcher.version).toBe(viaDirect.version);
      expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
    });

    it("no-op equivalent and reference semantics preserved", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "character_name" },
      };
      const viaDispatcher = mutate(draft, mutation, 1);
      const viaDirect = direct2B2(draft, mutation, 1);
      expect(viaDispatcher).toBe(draft);
      expect(viaDirect).toBe(draft);
    });

    it("version conflict error code equivalent", () => {
      const draft = makeVersionedDraft(5, 3);
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "B" },
      };
      const dispatcherCode = errorCodeOf(() => mutate(draft, mutation, 6));
      const directCode = errorCodeOf(() => direct2B2(draft, mutation, 6));
      expect(dispatcherCode).toBe("version_conflict");
      expect(directCode).toBe(dispatcherCode);
    });
  });

  describe("immutability", () => {
    it("successful apply does not mutate input draft", () => {
      const draft = makeSectionDraft();
      const original = JSON.parse(JSON.stringify(draft));
      mutate(
        draft,
        {
          op: "place_node",
          key: "Y",
          destination: { position: "inside", parentKey: "X" },
        },
        1,
      );
      expect(draft).toEqual(original);
    });

    it("successful apply does not mutate mutation object", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const original = JSON.parse(JSON.stringify(mutation));
      mutate(draft, mutation, 1);
      expect(mutation).toEqual(original);
    });

    it("successful apply does not mutate destination object", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const original = JSON.parse(JSON.stringify(mutation.destination));
      mutate(draft, mutation, 1);
      expect(mutation.destination).toEqual(original);
    });

    it("rejected apply does not mutate input draft", () => {
      const draft = makeSectionDraft();
      const original = JSON.parse(JSON.stringify(draft));
      try {
        mutate(
          draft,
          {
            op: "place_node",
            key: "Y",
            destination: { position: "inside", parentKey: "X" },
          },
          2,
        );
      } catch {
        // expected
      }
      expect(draft).toEqual(original);
    });

    it("rejected apply does not mutate mutation object", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const original = JSON.parse(JSON.stringify(mutation));
      try {
        mutate(draft, mutation, 7);
      } catch {
        // expected
      }
      expect(mutation).toEqual(original);
    });

    it("rejected apply does not mutate destination object", () => {
      const draft = makeFieldDraft();
      const mutation: DraftMutationV2 = {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      };
      const original = JSON.parse(JSON.stringify(mutation.destination));
      try {
        mutate(draft, mutation, 7);
      } catch {
        // expected
      }
      expect(mutation.destination).toEqual(original);
    });
  });
});
