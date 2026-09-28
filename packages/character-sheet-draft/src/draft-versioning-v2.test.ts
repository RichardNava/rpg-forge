import { describe, expect, it } from "vitest";
import {
  bumpDraftVersionV2,
  initialDraftVersionV2,
  type InitialCharacterSheetDraftV2,
} from "./draft-versioning-v2";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";
import {
  bumpDraftVersion,
  initialDraftVersion,
  nextDraftVersion,
} from "./versioning";
import { makeDraft as makeDraftV1 } from "./draft-fixture";
import type { CharacterSheetDraft } from "./draft-schema";

/**
 * Rich V2 fixture: multiple Fields, multiple Sections, one nested Section,
 * mixed Field/Section sibling ordering, values with a valid character_name
 * mirror, and non-null source metadata. The shape is canonical preorder and
 * passes `validateDraftV2`; every test starts from it.
 */
function makeRichDraftV2(version = 4, baseVersion = 1): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.versioning",
    sessionId: "session.versioning",
    baseVersion,
    version,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: "ctx.core.001",
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow"],
        locked: false,
      },
      { key: "loot", label: "Loot", type: "list", locked: false },
      { key: "secret", label: "Secret", type: "text", locked: true },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "attributes", title: "Attributes" },
      { key: "equipment", title: "Equipment" },
      { key: "legend", title: "Legend" },
    ],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "section", key: "attributes", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "notes", parentKey: "core" },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "section", key: "equipment", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "equipment" },
      { kind: "field", key: "loot", parentKey: "equipment" },
      { kind: "section", key: "legend", parentKey: null },
      { kind: "field", key: "secret", parentKey: "legend" },
    ],
    values: {
      character_name: "Aria Stone",
      strength: 12,
      notes: "A note",
      veteran: true,
      weapon: "sword",
      loot: ["coin", "ring"],
      secret: "hidden",
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: "run.0001" },
    confirmed: false,
  };
}

function makeInitialRichDraft(): InitialCharacterSheetDraftV2 {
  const {
    version: _version,
    baseVersion: _baseVersion,
    ...rest
  } = makeRichDraftV2();
  return rest;
}

function makeInitialV1(): Omit<CharacterSheetDraft, "version" | "baseVersion"> {
  const {
    version: _version,
    baseVersion: _baseVersion,
    ...rest
  } = makeDraftV1();
  return rest;
}

function draftErrorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("initialDraftVersionV2 — creation", () => {
  it("1. sets version = 1", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).version).toBe(1);
  });

  it("2. sets baseVersion = 1", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).baseVersion).toBe(1);
  });

  it("3. preserves schemaVersion = 2", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).schemaVersion).toBe(
      "2",
    );
  });

  it("4. preserves draftId", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).draftId).toBe(
      "draft.versioning",
    );
  });

  it("5. preserves sessionId", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).sessionId).toBe(
      "session.versioning",
    );
  });

  it("6. preserves mode", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).mode).toBe("pc");
  });

  it("7. preserves characterName", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).characterName).toBe(
      "Aria Stone",
    );
  });

  it("8. preserves rulesContextId", () => {
    expect(initialDraftVersionV2(makeInitialRichDraft()).rulesContextId).toBe(
      "ctx.core.001",
    );
  });

  it("9. preserves confirmed as supplied", () => {
    const input = { ...makeInitialRichDraft(), confirmed: true };
    expect(initialDraftVersionV2(input).confirmed).toBe(true);
  });

  it("10. preserves fields by exact reference", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input).fields).toBe(input.fields);
  });

  it("11. preserves sections by exact reference", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input).sections).toBe(input.sections);
  });

  it("12. preserves structure by exact reference", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input).structure).toBe(input.structure);
  });

  it("13. preserves values by exact reference", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input).values).toBe(input.values);
  });

  it("14. preserves source by exact reference", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input).source).toBe(input.source);
  });

  it("15. returns a new top-level object", () => {
    const input = makeInitialRichDraft();
    expect(initialDraftVersionV2(input)).not.toBe(input);
  });

  it("16. does not mutate the input object", () => {
    const input = makeInitialRichDraft();
    const snapshot = JSON.stringify(input);
    initialDraftVersionV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).not.toHaveProperty("version");
    expect(input).not.toHaveProperty("baseVersion");
  });

  it("17. produces a draft that passes validateDraftV2", () => {
    const created = initialDraftVersionV2(makeInitialRichDraft());
    expect(() => validateDraftV2(created)).not.toThrow();
  });
});

describe("initialDraftVersionV2 — structural requirements", () => {
  it("18. rejects a Field with no placement", () => {
    const input = makeInitialRichDraft();
    input.fields.push({
      key: "orphan",
      label: "Orphan",
      type: "text",
      locked: false,
    });
    expect(draftErrorCodeOf(() => initialDraftVersionV2(input))).toBe(
      "invalid_draft",
    );
  });

  it("19. rejects a Section with no placement", () => {
    const input = makeInitialRichDraft();
    input.sections.push({ key: "orphan_section", title: "Orphan Section" });
    expect(draftErrorCodeOf(() => initialDraftVersionV2(input))).toBe(
      "invalid_draft",
    );
  });

  it("20. rejects a structure that is not canonical preorder", () => {
    const input = makeInitialRichDraft();
    const [first, second] = input.structure;
    if (first === undefined || second === undefined) {
      throw new Error("fixture is not shaped as expected");
    }
    input.structure[0] = second;
    input.structure[1] = first;
    expect(draftErrorCodeOf(() => initialDraftVersionV2(input))).toBe(
      "invalid_draft",
    );
  });

  it("21. rejects a Field/Section key collision", () => {
    const input = makeInitialRichDraft();
    input.sections.push({ key: "strength", title: "Strength" });
    input.structure.push({
      kind: "section",
      key: "strength",
      parentKey: null,
    });
    expect(draftErrorCodeOf(() => initialDraftVersionV2(input))).toBe(
      "invalid_draft",
    );
  });

  it("22. rejects a characterName mirror mismatch", () => {
    const input = { ...makeInitialRichDraft(), characterName: "Someone Else" };
    expect(draftErrorCodeOf(() => initialDraftVersionV2(input))).toBe(
      "invalid_draft",
    );
  });

  it("does not infer placements for unplaced nodes", () => {
    const input = makeInitialRichDraft();
    input.fields.push({
      key: "orphan",
      label: "Orphan",
      type: "text",
      locked: false,
    });
    let thrown: DraftError | undefined;
    try {
      initialDraftVersionV2(input);
    } catch (error) {
      thrown = error as DraftError;
    }
    expect(thrown).toBeInstanceOf(DraftError);
    expect(thrown?.code).toBe("invalid_draft");
  });

  it("does not migrate a V1 body without a V2 structure snapshot", () => {
    const v1 = makeInitialV1();
    const withoutStructure = {
      schemaVersion: "2",
      draftId: v1.draftId,
      sessionId: v1.sessionId,
      mode: v1.mode,
      characterName: v1.characterName,
      rulesContextId: v1.rulesContextId,
      fields: v1.fields,
      sections: (v1.sections ?? []).map((section) => ({
        key: section.key,
        title: section.title,
      })),
      structure: [],
      values: v1.values,
      source: v1.source,
      confirmed: false,
    } satisfies InitialCharacterSheetDraftV2;
    expect(
      draftErrorCodeOf(() => initialDraftVersionV2(withoutStructure)),
    ).toBe("invalid_draft");
  });
});

describe("bumpDraftVersionV2 — version transition", () => {
  it("23. increments version 1 to 2", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2(1)).version).toBe(2);
  });

  it("24. increments version 7 to 8", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2(7)).version).toBe(8);
  });

  it("25. leaves baseVersion unchanged", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2(7, 3)).baseVersion).toBe(3);
  });

  it("26. keeps schemaVersion at 2", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2()).schemaVersion).toBe("2");
  });

  it("27. preserves confirmed false", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2()).confirmed).toBe(false);
  });

  it("28. preserves confirmed true", () => {
    const confirmed = { ...makeRichDraftV2(), confirmed: true };
    const bumped = bumpDraftVersionV2(confirmed);
    expect(bumped.confirmed).toBe(true);
    expect(bumped.version).toBe(5);
  });

  it("29. preserves characterName", () => {
    expect(bumpDraftVersionV2(makeRichDraftV2()).characterName).toBe(
      "Aria Stone",
    );
  });

  it("30. preserves fields by exact reference", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft).fields).toBe(draft.fields);
  });

  it("31. preserves sections by exact reference", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft).sections).toBe(draft.sections);
  });

  it("32. preserves structure by exact reference", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft).structure).toBe(draft.structure);
  });

  it("33. preserves values by exact reference", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft).values).toBe(draft.values);
  });

  it("34. preserves source by exact reference", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft).source).toBe(draft.source);
  });

  it("35. returns a new top-level object", () => {
    const draft = makeRichDraftV2();
    expect(bumpDraftVersionV2(draft)).not.toBe(draft);
  });

  it("36. does not mutate the original draft", () => {
    const draft = makeRichDraftV2(4, 3);
    const snapshot = JSON.stringify(draft);
    bumpDraftVersionV2(draft);
    expect(JSON.stringify(draft)).toBe(snapshot);
    expect(draft.version).toBe(4);
    expect(draft.baseVersion).toBe(3);
  });

  it("37. produces a candidate that passes validateDraftV2", () => {
    const bumped = bumpDraftVersionV2(makeRichDraftV2());
    expect(() => validateDraftV2(bumped)).not.toThrow();
  });

  it("preserves every non-version property exactly", () => {
    const draft = makeRichDraftV2(4, 3);
    const bumped = bumpDraftVersionV2(draft);
    expect(bumped.draftId).toBe(draft.draftId);
    expect(bumped.sessionId).toBe(draft.sessionId);
    expect(bumped.mode).toBe(draft.mode);
    expect(bumped.rulesContextId).toBe(draft.rulesContextId);
    expect(bumped.confirmed).toBe(draft.confirmed);
    expect(bumped.baseVersion).toBe(draft.baseVersion);
    expect(bumped.version).toBe(draft.version + 1);
  });

  it("does not reject a confirmed draft", () => {
    const confirmed = { ...makeRichDraftV2(), confirmed: true };
    expect(() => bumpDraftVersionV2(confirmed)).not.toThrow();
  });

  it("does not accept an expectedVersion precondition", () => {
    const draft = makeRichDraftV2();
    const withExtra = {
      ...draft,
      expectedVersion: draft.version,
    } as CharacterSheetDraftV2;
    expect(() => bumpDraftVersionV2(withExtra)).toThrowError(DraftError);
  });
});

describe("bumpDraftVersionV2 — version validation", () => {
  it("38. rejects version 0", () => {
    expect(draftErrorCodeOf(() => bumpDraftVersionV2(makeRichDraftV2(0)))).toBe(
      "invalid_draft",
    );
  });

  it("39. rejects a negative version", () => {
    expect(
      draftErrorCodeOf(() => bumpDraftVersionV2(makeRichDraftV2(-3))),
    ).toBe("invalid_draft");
  });

  it("40. rejects a fractional version", () => {
    expect(
      draftErrorCodeOf(() => bumpDraftVersionV2(makeRichDraftV2(2.5))),
    ).toBe("invalid_draft");
  });

  it("41. rejects NaN", () => {
    expect(
      draftErrorCodeOf(() => bumpDraftVersionV2(makeRichDraftV2(NaN))),
    ).toBe("invalid_draft");
  });

  it("delegates numeric validation to nextDraftVersion", () => {
    for (const version of [0, -1, 1.5, NaN]) {
      expect(() => nextDraftVersion(version)).toThrowError(DraftError);
      expect(
        draftErrorCodeOf(() => bumpDraftVersionV2(makeRichDraftV2(version))),
      ).toBe("invalid_draft");
    }
  });
});

describe("validation-gate reference behavior", () => {
  it("initialDraftVersionV2 returns the candidate, not a Zod clone", () => {
    const input = makeInitialRichDraft();
    const created = initialDraftVersionV2(input);
    expect(created.fields[0]).toBe(input.fields[0]);
    expect(created.sections[0]).toBe(input.sections[0]);
    expect(created.structure[0]).toBe(input.structure[0]);
    expect(created.values).toBe(input.values);
  });

  it("bumpDraftVersionV2 returns the candidate, not a Zod clone", () => {
    const draft = makeRichDraftV2();
    const bumped = bumpDraftVersionV2(draft);
    expect(bumped.fields[0]).toBe(draft.fields[0]);
    expect(bumped.sections[0]).toBe(draft.sections[0]);
    expect(bumped.structure[0]).toBe(draft.structure[0]);
    expect(bumped.values).toBe(draft.values);
  });
});

describe("V1 / V2 versioning parity", () => {
  it("initial creation parity: both produce version 1 and baseVersion 1", () => {
    const v1 = initialDraftVersion(makeInitialV1());
    const v2 = initialDraftVersionV2(makeInitialRichDraft());
    expect(v1.version).toBe(1);
    expect(v1.baseVersion).toBe(1);
    expect(v2.version).toBe(1);
    expect(v2.baseVersion).toBe(1);
  });

  it("bump parity: both increment once and keep baseVersion", () => {
    const v1Source = makeDraftV1({ version: 7, baseVersion: 3 });
    const v1 = bumpDraftVersion(v1Source);
    const v2 = bumpDraftVersionV2(makeRichDraftV2(7, 3));
    expect(v1.version).toBe(8);
    expect(v1.baseVersion).toBe(3);
    expect(v2.version).toBe(8);
    expect(v2.baseVersion).toBe(3);
    expect(v1Source.version).toBe(7);
  });
});
