import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  DraftError,
  applyDraftMutationV2,
  finalizeDraftV2,
  initialDraftVersionV2,
  parseDraftMutationV2,
  rerollLockedDraftValuesV2,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftMutationV2,
  type DraftRerollResultV2,
  type InitialCharacterSheetDraftV2,
} from "./index";

/**
 * Public V2 lifecycle boundary suite.
 *
 * Everything in this file is imported from the package root ("./index") on
 * purpose: the point of the slice is to prove that a future Worker/Web producer
 * can run the whole V2 lifecycle through the package root alone, with no deep
 * imports of versioning, reroll, finalize or the isolated 4A family primitives.
 */

/* ------------------------------------------------------------------ *
 * Compile-time proof of the public surface
 * ------------------------------------------------------------------ */

type PublicApi = typeof import("./index");
type AssertFalse<T extends false> = T;

/** Generic V2 version bumping is an implementation primitive, never public. */
type _BumpIsPrivate = AssertFalse<
  "bumpDraftVersionV2" extends keyof PublicApi ? true : false
>;
/** Isolated 4A1 content/value family primitive stays private. */
type _ContentFamilyIsPrivate = AssertFalse<
  "applyDraftContentMutationWithExpectedVersionV2" extends keyof PublicApi
    ? true
    : false
>;
/** Isolated 4A2 Field registry family primitive stays private. */
type _FieldFamilyIsPrivate = AssertFalse<
  "applyDraftFieldRegistryMutationWithExpectedVersionV2" extends keyof PublicApi
    ? true
    : false
>;
/** Isolated 4A3 Section registry family primitive stays private. */
type _SectionFamilyIsPrivate = AssertFalse<
  "applyDraftSectionRegistryMutationWithExpectedVersionV2" extends keyof PublicApi
    ? true
    : false
>;

/**
 * The tuple annotation is the real assertion: if any of the four symbols ever
 * became public, its slot would be typed `true` and `false` would not compile.
 * The runtime expectation below only keeps the type aliases referenced.
 */
const PRIVATE_SURFACE_FLAGS: [
  _BumpIsPrivate,
  _ContentFamilyIsPrivate,
  _FieldFamilyIsPrivate,
  _SectionFamilyIsPrivate,
] = [false, false, false, false];

/* ------------------------------------------------------------------ *
 * Fixtures and mutations (built through public types only)
 * ------------------------------------------------------------------ */

/**
 * Canonical V2 creation input: a nested Section, mixed Field/Section ordering,
 * two reroll-eligible locked Fields (bounded number + choice) and authored
 * values. `structure[]` is already valid preorder, because creation does not
 * infer placements.
 */
const INITIAL: InitialCharacterSheetDraftV2 = {
  schemaVersion: "2",
  draftId: "draft.lifecycle",
  sessionId: "session.lifecycle",
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
  ],
  sections: [
    { key: "core", title: "Core" },
    { key: "belongings", title: "Belongings" },
  ],
  structure: [
    { kind: "section", key: "core", parentKey: null },
    { kind: "field", key: "character_name", parentKey: "core" },
    { kind: "section", key: "belongings", parentKey: "core" },
    { kind: "field", key: "weapon", parentKey: "belongings" },
    { kind: "field", key: "strength", parentKey: null },
    { kind: "field", key: "notes", parentKey: null },
  ],
  values: {
    character_name: "Aria Stone",
    strength: 12,
    weapon: "sword",
    notes: "A note",
  },
  source: { sourceSheetId: "sheet.0001", sourceRunId: "run.0001" },
  confirmed: false,
};

const REROLL_SEED = "seed.lifecycle.001";

/** A real structural mutation: move the root Field "notes" before "strength". */
const MOVE_NOTES_BEFORE_STRENGTH: DraftMutationV2 = parseDraftMutationV2({
  op: "place_node",
  key: "notes",
  destination: { position: "before", targetKey: "strength" },
});

/** A real content mutation, used for the terminal immutability proofs. */
const SET_NOTES: DraftMutationV2 = parseDraftMutationV2({
  op: "set_value",
  key: "notes",
  value: "Changed after confirmation",
});

/**
 * The complete public lifecycle, in the order a future Worker producer would
 * run it: create -> edit -> reroll -> confirm.
 */
function runPublicLifecycle(): {
  initial: CharacterSheetDraftV2;
  mutated: CharacterSheetDraftV2;
  rerolled: DraftRerollResultV2;
  confirmed: CharacterSheetDraftV2;
} {
  const initial: CharacterSheetDraftV2 = initialDraftVersionV2(INITIAL);
  const mutated = applyDraftMutationV2(
    initial,
    MOVE_NOTES_BEFORE_STRENGTH,
    initial.version,
  );
  const rerolled: DraftRerollResultV2 = rerollLockedDraftValuesV2(
    mutated,
    REROLL_SEED,
  );
  const confirmed = finalizeDraftV2(rerolled.draft);
  return { initial, mutated, rerolled, confirmed };
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("public V2 lifecycle boundary — BLOCK A public surface", () => {
  it("exposes the V2 creation entry point from the package root", () => {
    expect(typeof initialDraftVersionV2).toBe("function");
    expect(initialDraftVersionV2.length).toBe(1);
  });

  it("exposes the V2 reroll entry point from the package root", () => {
    expect(typeof rerollLockedDraftValuesV2).toBe("function");
    expect(rerollLockedDraftValuesV2.length).toBe(2);
  });

  it("exposes the V2 confirmation entry point from the package root", () => {
    expect(typeof finalizeDraftV2).toBe("function");
    expect(finalizeDraftV2.length).toBe(1);
  });

  it("consumes InitialCharacterSheetDraftV2 through the package root", () => {
    const input: InitialCharacterSheetDraftV2 = INITIAL;
    const draft: CharacterSheetDraftV2 = initialDraftVersionV2(input);
    expect(draft.version).toBe(1);
    expect(draft.baseVersion).toBe(1);
  });

  it("consumes DraftRerollResultV2 through the package root", () => {
    const draft = initialDraftVersionV2(INITIAL);
    const result: DraftRerollResultV2 = rerollLockedDraftValuesV2(
      draft,
      REROLL_SEED,
    );
    expect(result.draft.version).toBe(2);
    expect(result.rerolledKeys).toEqual(["strength", "weapon"]);
  });

  it("keeps the generic version bump and the isolated family primitives private", () => {
    expect(PRIVATE_SURFACE_FLAGS).toEqual([false, false, false, false]);
  });
});

describe("public V2 lifecycle boundary — BLOCK B full journey", () => {
  it("public creation produces v1 with baseVersion 1", () => {
    const { initial } = runPublicLifecycle();
    expect(initial.schemaVersion).toBe("2");
    expect(initial.version).toBe(1);
    expect(initial.baseVersion).toBe(1);
    expect(initial.confirmed).toBe(false);
  });

  it("public mutation produces v2 and applies the requested placement", () => {
    const { initial, mutated } = runPublicLifecycle();
    expect(mutated.version).toBe(2);
    expect(mutated.confirmed).toBe(false);
    const rootKeys = mutated.structure
      .filter((placement) => placement.parentKey === null)
      .map((placement) => placement.key);
    expect(rootKeys).toEqual(["core", "notes", "strength"]);
    expect(initial.structure).not.toEqual(mutated.structure);
  });

  it("public reroll produces v3 and stays editable", () => {
    const { rerolled } = runPublicLifecycle();
    expect(rerolled.draft.version).toBe(3);
    expect(rerolled.draft.confirmed).toBe(false);
  });

  it("public confirmation produces v4 confirmed", () => {
    const { confirmed } = runPublicLifecycle();
    expect(confirmed.version).toBe(4);
    expect(confirmed.confirmed).toBe(true);
  });

  it("holds baseVersion at 1 and schemaVersion at 2 across every stage", () => {
    const { initial, mutated, rerolled, confirmed } = runPublicLifecycle();
    for (const snapshot of [initial, mutated, rerolled.draft, confirmed]) {
      expect(snapshot.baseVersion).toBe(1);
      expect(snapshot.schemaVersion).toBe("2");
      expect(snapshot.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
    }
  });

  it("increments the version exactly once per stage", () => {
    const { initial, mutated, rerolled, confirmed } = runPublicLifecycle();
    expect(mutated.version).toBe(initial.version + 1);
    expect(rerolled.draft.version).toBe(mutated.version + 1);
    expect(confirmed.version).toBe(rerolled.draft.version + 1);
  });

  it("validates every lifecycle snapshot as canonical V2", () => {
    const { initial, mutated, rerolled, confirmed } = runPublicLifecycle();
    for (const snapshot of [initial, mutated, rerolled.draft, confirmed]) {
      expect(validateDraftV2(snapshot)).toEqual(snapshot);
    }
  });

  it("preserves draft identity across the whole lifecycle", () => {
    const { initial, confirmed } = runPublicLifecycle();
    expect(confirmed.draftId).toBe(initial.draftId);
    expect(confirmed.sessionId).toBe(initial.sessionId);
    expect(confirmed.sections).toEqual(initial.sections);
  });
});

describe("public V2 lifecycle boundary — BLOCK C terminal state", () => {
  it("rejects a matching-version mutation on a confirmed snapshot", () => {
    const { confirmed } = runPublicLifecycle();
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version),
      ),
    ).toBe("draft_confirmed");
  });

  it("rejects a stale mutation on a confirmed snapshot with version_conflict", () => {
    const { confirmed } = runPublicLifecycle();
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(confirmed, SET_NOTES, confirmed.version - 1),
      ),
    ).toBe("version_conflict");
  });

  it("rejects reroll on a confirmed snapshot", () => {
    const { confirmed } = runPublicLifecycle();
    expect(
      errorCodeOf(() => rerollLockedDraftValuesV2(confirmed, REROLL_SEED)),
    ).toBe("draft_confirmed");
  });

  it("rejects structural placement on a confirmed snapshot", () => {
    const { confirmed } = runPublicLifecycle();
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          confirmed,
          MOVE_NOTES_BEFORE_STRENGTH,
          confirmed.version,
        ),
      ),
    ).toBe("draft_confirmed");
  });

  it("rejects re-confirmation of a confirmed snapshot", () => {
    const { confirmed } = runPublicLifecycle();
    expect(errorCodeOf(() => finalizeDraftV2(confirmed))).toBe(
      "draft_confirmed",
    );
    expect(confirmed.version).toBe(4);
  });
});

describe("public V2 lifecycle boundary — BLOCK D creation contract", () => {
  it("preserves the supplied canonical fields, sections, structure and values", () => {
    const initial = initialDraftVersionV2(INITIAL);
    expect(initial.fields).toBe(INITIAL.fields);
    expect(initial.sections).toBe(INITIAL.sections);
    expect(initial.structure).toBe(INITIAL.structure);
    expect(initial.values).toBe(INITIAL.values);
    expect(initial.source).toEqual(INITIAL.source);
  });

  it("rejects a field without a placement instead of inferring one", () => {
    const missingPlacement: InitialCharacterSheetDraftV2 = {
      ...INITIAL,
      structure: INITIAL.structure.filter(
        (placement) => placement.key !== "notes",
      ),
    };
    expect(errorCodeOf(() => initialDraftVersionV2(missingPlacement))).toBe(
      "invalid_draft",
    );
  });

  it("rejects a placement pointing at an unknown parent Section", () => {
    const unknownParent: InitialCharacterSheetDraftV2 = {
      ...INITIAL,
      structure: [
        { kind: "section", key: "core", parentKey: null },
        { kind: "field", key: "character_name", parentKey: "core" },
        { kind: "section", key: "belongings", parentKey: "core" },
        { kind: "field", key: "weapon", parentKey: "belongings" },
        { kind: "field", key: "strength", parentKey: null },
        { kind: "field", key: "notes", parentKey: "ghost" },
      ],
    };
    expect(errorCodeOf(() => initialDraftVersionV2(unknownParent))).toBe(
      "invalid_draft",
    );
  });

  it("does not mutate the creation input", () => {
    const snapshot = JSON.stringify(INITIAL);
    initialDraftVersionV2(INITIAL);
    expect(JSON.stringify(INITIAL)).toBe(snapshot);
  });
});

describe("public V2 lifecycle boundary — BLOCK E reroll contract", () => {
  it("reports the rerolled keys of the eligible locked Fields only", () => {
    const initial = initialDraftVersionV2(INITIAL);
    const { rerolledKeys, draft } = rerollLockedDraftValuesV2(
      initial,
      REROLL_SEED,
    );
    expect(rerolledKeys).toEqual(["strength", "weapon"]);
    const strength = draft.values["strength"];
    const weapon = draft.values["weapon"];
    expect(typeof strength).toBe("number");
    expect(strength).toBeGreaterThanOrEqual(1);
    expect(strength).toBeLessThanOrEqual(20);
    expect(["sword", "bow", "staff"]).toContain(weapon);
    expect(draft.values["notes"]).toBe(INITIAL.values["notes"]);
  });

  it("preserves structure and increments exactly once", () => {
    const initial = initialDraftVersionV2(INITIAL);
    const result = rerollLockedDraftValuesV2(initial, REROLL_SEED);
    expect(result.draft.structure).toBe(initial.structure);
    expect(result.draft.sections).toBe(initial.sections);
    expect(result.draft.fields).toBe(initial.fields);
    expect(result.draft.version).toBe(initial.version + 1);
    expect(result.draft.baseVersion).toBe(initial.baseVersion);
  });

  it("is deterministic for the same seed and snapshot", () => {
    const initial = initialDraftVersionV2(INITIAL);
    const first = rerollLockedDraftValuesV2(initial, REROLL_SEED);
    const second = rerollLockedDraftValuesV2(initial, REROLL_SEED);
    expect(first).toEqual(second);
    expect(first.rerolledKeys).toEqual(second.rerolledKeys);
  });
});

describe("public V2 lifecycle boundary — BLOCK F confirmation contract", () => {
  it("preserves the structure reference on confirmation", () => {
    const { rerolled, confirmed } = runPublicLifecycle();
    expect(confirmed.structure).toBe(rerolled.draft.structure);
  });

  it("preserves the values reference on confirmation", () => {
    const { rerolled, confirmed } = runPublicLifecycle();
    expect(confirmed.values).toBe(rerolled.draft.values);
    expect(confirmed.fields).toBe(rerolled.draft.fields);
    expect(confirmed.sections).toBe(rerolled.draft.sections);
  });

  it("confirmation changes only the version and the confirmed marker", () => {
    const { rerolled, confirmed } = runPublicLifecycle();
    expect({
      ...confirmed,
      version: rerolled.draft.version,
      confirmed: false,
    }).toEqual(rerolled.draft);
  });
});
