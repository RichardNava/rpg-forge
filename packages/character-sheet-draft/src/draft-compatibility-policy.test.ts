import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  CharacterSheetDraftV2Schema,
  DraftError,
  parseCanonicalCharacterSheetDraft,
  validateDraftV2,
} from "@repo/character-sheet-draft";
import {
  applyDraftMutationV2,
  type DraftMutationV2,
} from "./draft-mutation-v2";

function makeHistoricalV1() {
  return {
    schemaVersion: "1" as const,
    draftId: "draft.historical",
    sessionId: "session.historical",
    baseVersion: 3,
    version: 7,
    mode: "npc" as const,
    characterName: "Keeper",
    rulesContextId: "ctx.policy",
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
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
      { key: "history", label: "History", type: "textarea", locked: false },
    ],
    sections: [
      {
        key: "attributes",
        title: "Attributes",
        fieldKeys: ["str", "dex"],
      },
      {
        key: "sub",
        title: "Sub",
        parentKey: "attributes",
        fieldKeys: ["notes"],
      },
    ],
    values: {
      character_name: "Keeper",
      str: 10,
      dex: 12,
      notes: "note",
      history: "old",
    },
    source: { sourceSheetId: "sheet-1", sourceRunId: "run-2" },
    confirmed: false,
  };
}

function makeValidV2() {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.current",
    sessionId: "session.current",
    baseVersion: 5,
    version: 12,
    mode: "pc" as const,
    characterName: "Wren",
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
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    ],
    sections: [
      { key: "attributes", title: "Attributes" },
      { key: "social", title: "Social" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "attributes", parentKey: null },
      { kind: "field" as const, key: "str", parentKey: "attributes" },
      { kind: "field" as const, key: "dex", parentKey: "attributes" },
      { kind: "section" as const, key: "social", parentKey: null },
    ],
    values: { character_name: "Wren", str: 10, dex: 14 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DraftError) return error.code;
    throw error;
  }
  throw new Error("Expected a DraftError to be thrown.");
}

const realMove: DraftMutationV2 = {
  op: "place_node",
  key: "dex",
  destination: { position: "before", targetKey: "str" },
};

describe("compatibility read / domain policy", () => {
  describe("POLICY A — READ V1", () => {
    it("1. valid official V1 snapshot is accepted by the public canonical parser", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeHistoricalV1());
      expect(v2).toBeDefined();
    });

    it("2. result schemaVersion is '2'", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeHistoricalV1());
      expect(v2.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
    });

    it("3. result passes public validateDraftV2", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeHistoricalV1());
      expect(validateDraftV2(v2)).toEqual(v2);
    });

    it("4. read preserves version exactly", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.version).toBe(v1.version);
    });

    it("5. read preserves baseVersion exactly", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.baseVersion).toBe(v1.baseVersion);
    });

    it("6. read preserves confirmed", () => {
      const v1 = { ...makeHistoricalV1(), confirmed: true };
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.confirmed).toBe(true);
    });

    it("7. read preserves values", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.values).toEqual(v1.values);
    });

    it("8. read preserves metadata and provenance", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.draftId).toBe(v1.draftId);
      expect(v2.sessionId).toBe(v1.sessionId);
      expect(v2.mode).toBe(v1.mode);
      expect(v2.rulesContextId).toBe(v1.rulesContextId);
      expect(v2.source).toEqual(v1.source);
    });

    it("9. read does NOT mutate the source V1 object", () => {
      const v1 = makeHistoricalV1();
      const snapshot = JSON.stringify(v1);
      parseCanonicalCharacterSheetDraft(v1);
      expect(JSON.stringify(v1)).toBe(snapshot);
    });

    it("10. read does NOT increment version", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.version).toBe(v1.version);
    });

    it("11. read does NOT alter baseVersion", () => {
      const v1 = makeHistoricalV1();
      const v2 = parseCanonicalCharacterSheetDraft(v1);
      expect(v2.baseVersion).toBe(v1.baseVersion);
    });
  });

  describe("POLICY B — READ V2", () => {
    it("12. valid V2 snapshot is accepted", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result).toBeDefined();
    });

    it("13. result remains schemaVersion '2'", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(result.schemaVersion).toBe("2");
    });

    it("14. result validates as V2", () => {
      const result = parseCanonicalCharacterSheetDraft(makeValidV2());
      expect(CharacterSheetDraftV2Schema.safeParse(result).success).toBe(true);
    });

    it("15. version preserved", () => {
      const v2 = makeValidV2();
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.version).toBe(v2.version);
    });

    it("16. baseVersion preserved", () => {
      const v2 = makeValidV2();
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.baseVersion).toBe(v2.baseVersion);
    });

    it("17. confirmed preserved", () => {
      const v2 = makeValidV2();
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.confirmed).toBe(v2.confirmed);
    });

    it("18. values preserved", () => {
      const v2 = makeValidV2();
      const result = parseCanonicalCharacterSheetDraft(v2);
      expect(result.values).toEqual(v2.values);
    });

    it("19. source V2 object is not mutated", () => {
      const v2 = makeValidV2();
      const snapshot = JSON.stringify(v2);
      parseCanonicalCharacterSheetDraft(v2);
      expect(JSON.stringify(v2)).toBe(snapshot);
    });
  });

  describe("POLICY C — INVALID / UNKNOWN INPUT", () => {
    it("20. unknown schemaVersion is rejected", () => {
      const input = { ...makeHistoricalV1(), schemaVersion: "3" };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("21. missing schemaVersion is rejected", () => {
      const input = { ...makeHistoricalV1() };
      delete (input as { schemaVersion?: string }).schemaVersion;
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("22. malformed declared V1 is rejected", () => {
      const input = {
        ...makeHistoricalV1(),
        sections: [
          { key: "attributes", title: "Attributes", fieldKeys: ["str", "dex"] },
          {
            key: "sub",
            title: "Sub",
            parentKey: "ghost",
            fieldKeys: ["notes"],
          },
        ],
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("23. malformed declared V2 is rejected", () => {
      const input = { ...makeValidV2(), structure: [] };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("24. invalid V1 does not fall through to V2", () => {
      const input = {
        ...makeHistoricalV1(),
        schemaVersion: "1" as const,
        structure: [
          { kind: "field" as const, key: "str", parentKey: null },
          { kind: "field" as const, key: "dex", parentKey: null },
        ],
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("25. invalid V2 does not fall through to V1", () => {
      const input = {
        ...makeHistoricalV1(),
        schemaVersion: "2" as const,
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });

    it("26. malformed input is not auto-repaired", () => {
      const input = {
        ...makeHistoricalV1(),
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            fieldKeys: ["str", "missing"],
          },
        ],
      };
      expect(() => parseCanonicalCharacterSheetDraft(input)).toThrowError(
        DraftError,
      );
    });
  });

  describe("POLICY D — V1 READ THEN REAL V2 MUTATION", () => {
    const v1 = makeHistoricalV1();
    const canonical = parseCanonicalCharacterSheetDraft(v1);
    const canonicalSnapshot = JSON.stringify(canonical);

    it("27. canonical input before mutation is V2", () => {
      expect(canonical.schemaVersion).toBe("2");
      expect(canonical.version).toBe(7);
    });

    it("28. resulting snapshot is V2", () => {
      const result = applyDraftMutationV2(canonical, realMove, 7);
      expect(result.schemaVersion).toBe("2");
    });

    it("29. resulting snapshot passes validateDraftV2", () => {
      const result = applyDraftMutationV2(canonical, realMove, 7);
      expect(validateDraftV2(result)).toEqual(result);
    });

    it("30. real mutation bumps version exactly once", () => {
      const result = applyDraftMutationV2(canonical, realMove, 7);
      expect(result.version).toBe(canonical.version + 1);
    });

    it("31. baseVersion remains unchanged", () => {
      const result = applyDraftMutationV2(canonical, realMove, 7);
      expect(result.baseVersion).toBe(canonical.baseVersion);
    });

    it("32. original V1 source remains unchanged", () => {
      expect(validateDraftV2(canonical)).toEqual(canonical);
      applyDraftMutationV2(canonical, realMove, 7);
      expect(JSON.stringify(canonical)).toBe(canonicalSnapshot);
      expect(JSON.stringify(v1)).toBe(JSON.stringify(makeHistoricalV1()));
    });

    it("33. canonical pre-mutation snapshot remains unchanged", () => {
      applyDraftMutationV2(canonical, realMove, 7);
      expect(JSON.stringify(canonical)).toBe(canonicalSnapshot);
      expect(canonical.version).toBe(7);
    });
  });

  describe("POLICY E — V1 READ THEN NO-OP", () => {
    const v1 = makeHistoricalV1();
    const canonical = parseCanonicalCharacterSheetDraft(v1);

    const noOp: DraftMutationV2 = {
      op: "place_node",
      key: "history",
      destination: { position: "after", targetKey: "character_name" },
    };

    it("34. result remains schemaVersion '2'", () => {
      const result = applyDraftMutationV2(canonical, noOp, canonical.version);
      expect(result.schemaVersion).toBe("2");
    });

    it("35. result is the exact canonical V2 reference", () => {
      const result = applyDraftMutationV2(canonical, noOp, canonical.version);
      expect(result).toBe(canonical);
    });

    it("36. version does not bump", () => {
      const result = applyDraftMutationV2(canonical, noOp, canonical.version);
      expect(result.version).toBe(canonical.version);
    });

    it("37. baseVersion does not change", () => {
      const result = applyDraftMutationV2(canonical, noOp, canonical.version);
      expect(result.baseVersion).toBe(canonical.baseVersion);
    });

    it("38. original V1 input remains unchanged", () => {
      const v1Snapshot = JSON.stringify(v1);
      applyDraftMutationV2(canonical, noOp, canonical.version);
      expect(JSON.stringify(v1)).toBe(v1Snapshot);
    });
  });

  describe("POLICY F — CONFIRMED HISTORICAL V1", () => {
    const confirmedV1 = { ...makeHistoricalV1(), confirmed: true };
    const canonical = parseCanonicalCharacterSheetDraft(confirmedV1);
    const canonicalSnapshot = JSON.stringify(canonical);

    it("39. canonical result is V2", () => {
      expect(canonical.schemaVersion).toBe("2");
    });

    it("40. confirmed remains true", () => {
      expect(canonical.confirmed).toBe(true);
    });

    it("41. version preserved on read", () => {
      expect(canonical.version).toBe(confirmedV1.version);
    });

    it("42. baseVersion preserved on read", () => {
      expect(canonical.baseVersion).toBe(confirmedV1.baseVersion);
    });

    it("43. matching-version mutation rejects with draft_confirmed", () => {
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version),
      ).toThrowError(DraftError);
      expect(
        errorCodeOf(() =>
          applyDraftMutationV2(canonical, realMove, canonical.version),
        ),
      ).toBe("draft_confirmed");
    });

    it("44. rejection does not mutate the canonical draft", () => {
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version),
      ).toThrowError(DraftError);
      expect(JSON.stringify(canonical)).toBe(canonicalSnapshot);
    });

    it("45. rejection does not mutate the original V1 source", () => {
      const v1Snapshot = JSON.stringify(confirmedV1);
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version),
      ).toThrowError(DraftError);
      expect(JSON.stringify(confirmedV1)).toBe(v1Snapshot);
    });
  });

  describe("POLICY G — VERSION CONFLICT AFTER V1 READ", () => {
    const v1 = makeHistoricalV1();
    const canonical = parseCanonicalCharacterSheetDraft(v1);
    const canonicalSnapshot = JSON.stringify(canonical);

    it("46. expectedVersion mismatch yields version_conflict", () => {
      expect(
        errorCodeOf(() =>
          applyDraftMutationV2(canonical, realMove, canonical.version + 1),
        ),
      ).toBe("version_conflict");
    });

    it("47. canonical draft unchanged", () => {
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version + 1),
      ).toThrowError(DraftError);
      expect(JSON.stringify(canonical)).toBe(canonicalSnapshot);
    });

    it("48. original V1 source unchanged", () => {
      const v1Snapshot = JSON.stringify(v1);
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version + 1),
      ).toThrowError(DraftError);
      expect(JSON.stringify(v1)).toBe(v1Snapshot);
    });

    it("49. no version bump occurs", () => {
      expect(() =>
        applyDraftMutationV2(canonical, realMove, canonical.version + 1),
      ).toThrowError(DraftError);
      const post = parseCanonicalCharacterSheetDraft(v1);
      expect(post.version).toBe(canonical.version);
    });
  });

  describe("OPTIONAL — deterministic V1→V2 ordering across the read", () => {
    it("preserves approved root/nested/unassigned-field ordering", () => {
      const v2 = parseCanonicalCharacterSheetDraft(makeHistoricalV1());
      expect(v2.structure.map((p) => p.key)).toEqual([
        "attributes",
        "str",
        "dex",
        "sub",
        "notes",
        "character_name",
        "history",
      ]);
      expect(v2.structure[0]).toMatchObject({
        kind: "section",
        key: "attributes",
        parentKey: null,
      });
      expect(v2.structure[3]).toMatchObject({
        kind: "section",
        key: "sub",
        parentKey: "attributes",
      });
      expect(v2.structure[5]).toMatchObject({
        kind: "field",
        key: "character_name",
        parentKey: null,
      });
    });
  });
});
