import { describe, expect, it } from "vitest";
import { finalizeDraftV2 } from "./draft-finalize-v2";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import { bumpDraftVersionV2 } from "./draft-versioning-v2";
import { rerollLockedDraftValuesV2 } from "./draft-reroll-v2";
import {
  applyDraftMutationV2,
  parseDraftMutationV2,
  type DraftMutationV2,
} from "./draft-mutation-v2";
import { DraftError } from "./errors";

/**
 * Rich canonical V2 fixture: multiple Fields, multiple Sections, a nested
 * Section, mixed Field/Section ordering, authored values with a valid
 * `character_name` mirror, `version > 1`, a `baseVersion` distinct from
 * `version`, and source metadata. Confirmed is false so the draft is
 * confirmable. The shape is canonical preorder and passes `validateDraftV2`
 * before finalization.
 */
function makeEditableDraft(
  version = 7,
  baseVersion = 2,
): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.finalize",
    sessionId: "session.finalize",
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
        locked: true,
      },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow", "staff"],
        locked: true,
      },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
      { key: "loot", label: "Loot", type: "list", locked: false },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "attributes", title: "Attributes" },
      { key: "belongings", title: "Belongings" },
    ],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "section", key: "attributes", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "notes", parentKey: "core" },
      { kind: "section", key: "belongings", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "belongings" },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "field", key: "loot", parentKey: null },
    ],
    values: {
      character_name: "Aria Stone",
      strength: 12,
      weapon: "sword",
      notes: "A note",
      veteran: true,
      loot: ["coin", "ring"],
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: "run.0001" },
    confirmed: false,
  };
}

/** A deeply equal but reference-distinct copy of the editable fixture. */
function makeEquivalentEditableDraft(): CharacterSheetDraftV2 {
  const base = makeEditableDraft();
  return JSON.parse(JSON.stringify(base)) as CharacterSheetDraftV2;
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

const SET_NOTES: DraftMutationV2 = parseDraftMutationV2({
  op: "set_value",
  key: "notes",
  value: "Changed after confirmation",
});

describe("finalizeDraftV2 — basic confirmation", () => {
  it("1. sets confirmed to true", () => {
    expect(finalizeDraftV2(makeEditableDraft()).confirmed).toBe(true);
  });

  it("2. increments the version exactly once", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).version).toBe(draft.version + 1);
  });

  it("3. increments version 7 to 8", () => {
    expect(finalizeDraftV2(makeEditableDraft(7, 2)).version).toBe(8);
  });

  it("4. leaves baseVersion unchanged", () => {
    expect(finalizeDraftV2(makeEditableDraft(7, 2)).baseVersion).toBe(2);
  });

  it("5. keeps schemaVersion at 2", () => {
    expect(finalizeDraftV2(makeEditableDraft()).schemaVersion).toBe("2");
  });

  it("6. preserves draftId", () => {
    expect(finalizeDraftV2(makeEditableDraft()).draftId).toBe("draft.finalize");
  });

  it("7. preserves sessionId", () => {
    expect(finalizeDraftV2(makeEditableDraft()).sessionId).toBe(
      "session.finalize",
    );
  });

  it("8. preserves mode", () => {
    expect(finalizeDraftV2(makeEditableDraft()).mode).toBe("pc");
  });

  it("9. preserves characterName", () => {
    expect(finalizeDraftV2(makeEditableDraft()).characterName).toBe(
      "Aria Stone",
    );
  });

  it("10. preserves rulesContextId", () => {
    expect(finalizeDraftV2(makeEditableDraft()).rulesContextId).toBe(
      "ctx.core.001",
    );
  });

  it("11. preserves source", () => {
    expect(finalizeDraftV2(makeEditableDraft()).source).toEqual({
      sourceSheetId: "sheet.0001",
      sourceRunId: "run.0001",
    });
  });

  it("12. produces a canonical V2 draft", () => {
    expect(() =>
      validateDraftV2(finalizeDraftV2(makeEditableDraft())),
    ).not.toThrow();
  });

  it("confirms a draft at version 1 with baseVersion 1", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft(1, 1));
    expect(confirmed.version).toBe(2);
    expect(confirmed.baseVersion).toBe(1);
    expect(confirmed.confirmed).toBe(true);
  });
});

describe("finalizeDraftV2 — content preservation", () => {
  it("13. leaves fields deeply unchanged", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).fields).toEqual(draft.fields);
  });

  it("14. leaves sections deeply unchanged", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).sections).toEqual(draft.sections);
  });

  it("15. leaves structure deeply unchanged", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).structure).toEqual(draft.structure);
  });

  it("16. leaves values deeply unchanged", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).values).toEqual(draft.values);
  });

  it("17. performs no reroll of locked draw-grammar Fields", () => {
    const draft = makeEditableDraft();
    const confirmed = finalizeDraftV2(draft);
    expect(confirmed.values.strength).toBe(12);
    expect(confirmed.values.weapon).toBe("sword");
  });

  it("18. performs no Field lock changes", () => {
    const draft = makeEditableDraft();
    const confirmed = finalizeDraftV2(draft);
    const locks = confirmed.fields.map((field) => field.locked);
    expect(locks).toEqual(draft.fields.map((field) => field.locked));
    expect(locks.filter(Boolean)).toHaveLength(2);
  });

  it("19. performs no Section title changes", () => {
    const draft = makeEditableDraft();
    const confirmed = finalizeDraftV2(draft);
    expect(confirmed.sections.map((section) => section.title)).toEqual(
      draft.sections.map((section) => section.title),
    );
  });

  it("20. performs no placement changes", () => {
    const draft = makeEditableDraft();
    const confirmed = finalizeDraftV2(draft);
    const placements: DraftPlacement[] = confirmed.structure;
    expect(placements).toEqual(draft.structure);
  });

  it("only confirmed and version differ from the input", () => {
    const draft = makeEditableDraft();
    const confirmed = finalizeDraftV2(draft);
    expect({ ...confirmed, version: draft.version, confirmed: false }).toEqual(
      draft,
    );
  });
});

describe("finalizeDraftV2 — reference preservation", () => {
  it("21. returns a new top-level object", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft)).not.toBe(draft);
  });

  it("22. preserves the fields registry by exact reference", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).fields).toBe(draft.fields);
  });

  it("23. preserves sections by exact reference", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).sections).toBe(draft.sections);
  });

  it("24. preserves structure by exact reference", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).structure).toBe(draft.structure);
  });

  it("25. preserves values by exact reference", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).values).toBe(draft.values);
  });

  it("26. preserves source by exact reference", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).source).toBe(draft.source);
  });

  it("27. preserves fields[0] element identity", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).fields[0]).toBe(draft.fields[0]);
  });

  it("28. preserves sections[0] element identity", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).sections[0]).toBe(draft.sections[0]);
  });

  it("29. preserves structure[0] element identity", () => {
    const draft = makeEditableDraft();
    expect(finalizeDraftV2(draft).structure[0]).toBe(draft.structure[0]);
  });

  it("leaves the input draft deeply unchanged", () => {
    const draft = makeEditableDraft();
    const snapshot = JSON.stringify(draft);
    finalizeDraftV2(draft);
    expect(JSON.stringify(draft)).toBe(snapshot);
    expect(draft.confirmed).toBe(false);
    expect(draft.version).toBe(7);
  });
});

describe("finalizeDraftV2 — already confirmed", () => {
  it("30. rejects an already-confirmed draft with draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(errorCodeOf(() => finalizeDraftV2(confirmed))).toBe(
      "draft_confirmed",
    );
  });

  it("30b. throws DraftError", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(() => finalizeDraftV2(confirmed)).toThrowError(DraftError);
  });

  it("31. does not bump the version on a second confirmation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    try {
      finalizeDraftV2(confirmed);
    } catch {
      // expected
    }
    expect(confirmed.version).toBe(8);
  });

  it("31b. never produces version N+2", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft(7, 2));
    expect(confirmed.version).toBe(8);
    expect(errorCodeOf(() => finalizeDraftV2(confirmed))).toBe(
      "draft_confirmed",
    );
  });

  it("32. does not change baseVersion on a second confirmation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft(7, 3));
    try {
      finalizeDraftV2(confirmed);
    } catch {
      // expected
    }
    expect(confirmed.baseVersion).toBe(3);
  });

  it("33. does not mutate values on a second confirmation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    const snapshot = JSON.stringify(confirmed.values);
    try {
      finalizeDraftV2(confirmed);
    } catch {
      // expected
    }
    expect(JSON.stringify(confirmed.values)).toBe(snapshot);
  });

  it("34. does not mutate structure on a second confirmation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    const snapshot = JSON.stringify(confirmed.structure);
    try {
      finalizeDraftV2(confirmed);
    } catch {
      // expected
    }
    expect(JSON.stringify(confirmed.structure)).toBe(snapshot);
  });

  it("35. leaves the confirmed input deeply unchanged on rejection", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    const snapshot = JSON.stringify(confirmed);
    try {
      finalizeDraftV2(confirmed);
    } catch {
      // expected
    }
    expect(JSON.stringify(confirmed)).toBe(snapshot);
  });
});

describe("finalizeDraftV2 — terminal immutability integration", () => {
  it("36. rejects a matching-version mutation with draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version),
      ),
    ).toBe("draft_confirmed");
  });

  it("36b. rejects a structural mutation with draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    const move = parseDraftMutationV2({
      op: "place_node",
      key: "notes",
      destination: { position: "before", targetKey: "strength" },
    });
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, move, confirmed.version),
      ),
    ).toBe("draft_confirmed");
  });

  it("37. rejects a reroll with draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(
      errorCodeOf(() => rerollLockedDraftValuesV2(confirmed, "seed")),
    ).toBe("draft_confirmed");
  });

  it("38. rejects a re-confirmation with draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(errorCodeOf(() => finalizeDraftV2(confirmed))).toBe(
      "draft_confirmed",
    );
  });

  it("confirms that only confirmed and version changed before rejection", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.version).toBe(8);
    expect(
      errorCodeOf(() => rerollLockedDraftValuesV2(confirmed, "seed")),
    ).toBe("draft_confirmed");
  });
});

describe("finalizeDraftV2 — mutation precedence against a confirmed snapshot", () => {
  it("39. yields version_conflict for a stale mutation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(
      errorCodeOf(() => applyDraftMutationV2(confirmed, SET_NOTES, 0)),
    ).toBe("version_conflict");
  });

  it("39b. yields version_conflict for a future expectedVersion", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version + 1),
      ),
    ).toBe("version_conflict");
  });

  it("40. yields draft_confirmed for a matching-version mutation", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version),
      ),
    ).toBe("draft_confirmed");
  });

  it("keeps version_conflict ahead of draft_confirmed", () => {
    const confirmed = finalizeDraftV2(makeEditableDraft());
    const stale = errorCodeOf(() =>
      applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version - 1),
    );
    const matching = errorCodeOf(() =>
      applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version),
    );
    expect(stale).toBe("version_conflict");
    expect(matching).toBe("draft_confirmed");
  });
});

describe("finalizeDraftV2 — determinism", () => {
  it("41. produces deeply equal output for deeply equal inputs", () => {
    const a = finalizeDraftV2(makeEditableDraft());
    const b = finalizeDraftV2(makeEquivalentEditableDraft());
    expect(a).toEqual(b);
  });

  it("42. does not depend on any seed or randomness", () => {
    const first = finalizeDraftV2(makeEditableDraft());
    const second = finalizeDraftV2(makeEditableDraft());
    const third = finalizeDraftV2(makeEquivalentEditableDraft());
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("43. produces deep-equal confirmed snapshots from repeated fresh inputs", () => {
    const outputs = [
      finalizeDraftV2(makeEditableDraft()),
      finalizeDraftV2(makeEditableDraft()),
      finalizeDraftV2(makeEquivalentEditableDraft()),
    ];
    expect(outputs[1]).toEqual(outputs[0]);
    expect(outputs[2]).toEqual(outputs[0]);
  });

  it("does not mutate the confirmed flag of the source draft", () => {
    const draft = makeEditableDraft();
    finalizeDraftV2(draft);
    expect(draft.confirmed).toBe(false);
  });
});

describe("finalizeDraftV2 — 4B1 integration", () => {
  it("matches bumpDraftVersionV2 for version, baseVersion and confirmed", () => {
    const draft = makeEditableDraft(7, 3);
    const confirmed = finalizeDraftV2(draft);
    const expected = bumpDraftVersionV2({ ...draft, confirmed: true });
    expect(confirmed.version).toBe(expected.version);
    expect(confirmed.baseVersion).toBe(expected.baseVersion);
    expect(confirmed.confirmed).toBe(expected.confirmed);
  });

  it("delegates the whole confirmed snapshot to 4B1", () => {
    const draft = makeEditableDraft(7, 3);
    const confirmed = finalizeDraftV2(draft);
    const expected = bumpDraftVersionV2({ ...draft, confirmed: true });
    expect(confirmed).toEqual(expected);
  });

  it("bumps exactly once, never twice", () => {
    const draft = makeEditableDraft(7, 3);
    const confirmed = finalizeDraftV2(draft);
    expect(confirmed.version).toBe(8);
    expect(confirmed.version).not.toBe(bumpDraftVersionV2(confirmed).version);
  });

  it("inherits 4B1 version validation for a malformed source version", () => {
    const draft = { ...makeEditableDraft(0, 2) } as CharacterSheetDraftV2;
    expect(errorCodeOf(() => finalizeDraftV2(draft))).toBe("invalid_draft");
  });
});

describe("finalizeDraftV2 — 4B2 lifecycle integration", () => {
  it("walks editable vN to rerolled vN+1 to confirmed vN+2", () => {
    const editable = makeEditableDraft(7, 3);
    const rerolled = rerollLockedDraftValuesV2(editable, "lifecycle-seed");
    const confirmed = finalizeDraftV2(rerolled.draft);
    expect(rerolled.draft.version).toBe(8);
    expect(rerolled.draft.confirmed).toBe(false);
    expect(confirmed.version).toBe(9);
    expect(confirmed.confirmed).toBe(true);
  });

  it("keeps baseVersion unchanged across reroll and confirm", () => {
    const editable = makeEditableDraft(7, 3);
    const rerolled = rerollLockedDraftValuesV2(editable, "lifecycle-seed");
    const confirmed = finalizeDraftV2(rerolled.draft);
    expect(rerolled.draft.baseVersion).toBe(3);
    expect(confirmed.baseVersion).toBe(3);
  });

  it("does not double-bump in either stage", () => {
    const editable = makeEditableDraft(7, 3);
    const rerolled = rerollLockedDraftValuesV2(editable, "lifecycle-seed");
    const confirmed = finalizeDraftV2(rerolled.draft);
    expect(rerolled.draft.version).toBe(bumpDraftVersionV2(editable).version);
    expect(confirmed.version).toBe(bumpDraftVersionV2(rerolled.draft).version);
  });

  it("preserves rerolled values through confirmation", () => {
    const editable = makeEditableDraft(7, 3);
    const rerolled = rerollLockedDraftValuesV2(editable, "lifecycle-seed");
    const confirmed = finalizeDraftV2(rerolled.draft);
    expect(confirmed.values).toBe(rerolled.draft.values);
    expect(confirmed.values.strength).toBe(rerolled.draft.values.strength);
  });

  it("reports the rerolled keys before confirmation", () => {
    const editable = makeEditableDraft(7, 3);
    const rerolled = rerollLockedDraftValuesV2(editable, "lifecycle-seed");
    expect([...rerolled.rerolledKeys].sort()).toEqual(["strength", "weapon"]);
    finalizeDraftV2(rerolled.draft);
  });
});
