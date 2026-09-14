import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  rerollLockedDraftValues,
  stableDraftSeed,
  validateDraft,
} from "./index";
import { makeDraft } from "./draft-fixture";

describe("seeded reroll randomness", () => {
  it("reproduces the same stream for the same seed", () => {
    const a = createSeededRandom(stableDraftSeed("same-seed"));
    const b = createSeededRandom(stableDraftSeed("same-seed"));
    expect(Array.from({ length: 5 }, () => a())).toEqual(
      Array.from({ length: 5 }, () => b()),
    );
  });

  it("produces values inside [0, 1)", () => {
    const random = createSeededRandom(stableDraftSeed("bounds"));
    for (let index = 0; index < 100; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("differs for different seeds", () => {
    const a = createSeededRandom(stableDraftSeed("a"));
    const b = createSeededRandom(stableDraftSeed("b"));
    const streamA = Array.from({ length: 8 }, () => a()).join(",");
    const streamB = Array.from({ length: 8 }, () => b()).join(",");
    expect(streamA).not.toBe(streamB);
  });
});

describe("draft reroll", () => {
  it("regenerates only locked fields with a draw grammar", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValues(
      makeDraft(),
      "reroll-seed-1",
    );
    expect(rerolledKeys.sort()).toEqual(["strength", "weapon"]);
    expect(draft.values.homeland).toBe("Riverside");
    expect(draft.values.veteran).toBe(true);
    expect(draft.values.character_name).toBe("Aria Stone");
  });

  it("keeps every regenerated value inside its grammar", () => {
    for (const seed of ["s-a", "s-b", "s-c"]) {
      const { draft } = rerollLockedDraftValues(makeDraft(), seed);
      const strength = draft.values.strength as number;
      expect(strength).toBeGreaterThanOrEqual(1);
      expect(strength).toBeLessThanOrEqual(20);
      expect(["sword", "bow", "staff"]).toContain(draft.values.weapon);
    }
  });

  it("reproduces the same values for the same seed and snapshot", () => {
    const draft = makeDraft();
    const first = rerollLockedDraftValues(draft, "repro-seed");
    const second = rerollLockedDraftValues(draft, "repro-seed");
    expect(first.draft).toEqual(second.draft);
    expect(first.rerolledKeys).toEqual(second.rerolledKeys);
  });

  it("preserves the characterName display convenience", () => {
    const { draft } = rerollLockedDraftValues(makeDraft(), "name-seed");
    expect(draft.characterName).toBe("Aria Stone");
    expect(draft.values.character_name).toBe("Aria Stone");
  });

  it("keeps explicitly authored values through the reroll", () => {
    const draft = makeDraft();
    const strength = draft.values.strength as number;
    const unlocked = {
      ...draft,
      fields: draft.fields.map((field) =>
        field.key === "strength" ? { ...field, locked: false } : field,
      ),
    };
    const { rerolledKeys } = rerollLockedDraftValues(unlocked, "authored-seed");
    expect(rerolledKeys).not.toContain("strength");
    expect(unlocked.values.strength).toBe(strength);
  });

  it("leaves a locked text field untouched (no draw grammar)", () => {
    const draft = makeDraft({
      fields: [
        { key: "truename", label: "True Name", type: "text", locked: true },
      ],
      values: { truename: "Solomon" },
    });
    const { rerolledKeys } = rerollLockedDraftValues(draft, "grammar-seed");
    expect(rerolledKeys).toEqual([]);
    expect(draft.values.truename).toBe("Solomon");
  });

  it("produces a schema-valid snapshot after a reroll", () => {
    const { draft } = rerollLockedDraftValues(makeDraft(), "valid-seed");
    expect(() => validateDraft(draft)).not.toThrow();
  });
});
