import { describe, expect, it } from "vitest";
import {
  rerollLockedDraftValuesV2,
  type DraftRerollResultV2,
} from "./draft-reroll-v2";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { bumpDraftVersionV2 } from "./draft-versioning-v2";
import { defaultDraftLayoutV1 } from "./draft-layout-v1";
import type { DraftField } from "./draft-schema";
import { DraftError } from "./errors";

const FIELDS: DraftField[] = [
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
  {
    key: "agility",
    label: "Agility",
    type: "number",
    min: 1,
    max: 20,
    locked: false,
  },
  {
    key: "armor",
    label: "Armor",
    type: "choice",
    options: ["leather", "plate"],
    locked: false,
  },
  { key: "epithet", label: "Epithet", type: "text", locked: true },
  { key: "history", label: "History", type: "textarea", locked: true },
  { key: "veteran", label: "Veteran", type: "checkbox", locked: true },
  { key: "keepsakes", label: "Keepsakes", type: "list", locked: true },
];

const VALUES: Record<string, unknown> = {
  character_name: "Aria Stone",
  strength: 12,
  weapon: "sword",
  agility: 14,
  armor: "leather",
  epithet: "the Bold",
  history: "Riverside",
  veteran: true,
  keepsakes: ["ring"],
  constant: 7,
  only: "one",
  half: 3,
  none: 4,
};

/** Field kinds with no explicit authored value fall back to a type default. */
const TYPE_DEFAULTS: Record<string, unknown> = {
  text: "unset",
  textarea: "unset",
  number: 1,
  checkbox: false,
  list: [],
};

/**
 * Parent assignment splits the Field registry into at most four CONTIGUOUS
 * registry-ordered blocks, so each parent owns exactly one contiguous run and
 * the emitted `structure` is canonical preorder. `attributes` nests under
 * `core`; `belongings` is a Root sibling; the final block sits at Root. This
 * keeps Section/Field sibling ordering mixed and gives a Section a non-null
 * parent.
 */
const SECTION_OWNERS: (string | null)[] = [
  "core",
  "attributes",
  "belongings",
  null,
];

function parentFor(index: number, total: number): string | null {
  const blocks = Math.min(SECTION_OWNERS.length, total);
  const blockSize = Math.max(1, Math.ceil(total / blocks));
  const block = Math.min(blocks - 1, Math.floor(index / blockSize));
  return SECTION_OWNERS[block] ?? null;
}

function valuesForFields(
  fields: DraftField[],
): CharacterSheetDraftV2["values"] {
  const values: CharacterSheetDraftV2["values"] = {};
  for (const field of fields) {
    const authored = VALUES[field.key];
    if (authored !== undefined) {
      values[field.key] = authored as never;
    } else {
      values[field.key] = (TYPE_DEFAULTS[field.type] ?? null) as never;
    }
  }
  return values;
}

function structureForFields(
  fields: DraftField[],
): CharacterSheetDraftV2["structure"] {
  const structure: CharacterSheetDraftV2["structure"] = [];
  // `attributes` nests under `core`; `belongings` is a Root sibling. Each
  // Section is emitted exactly once, immediately followed by its own
  // contiguous block of Fields, which is canonical preorder.
  const sectionOrder: { key: string; parentKey: string | null }[] = [
    { key: "core", parentKey: null },
    { key: "attributes", parentKey: "core" },
    { key: "belongings", parentKey: null },
  ];
  for (const { key, parentKey } of sectionOrder) {
    structure.push({ kind: "section", key, parentKey });
    for (const [index, field] of fields.entries()) {
      if (parentFor(index, fields.length) === key) {
        structure.push({ kind: "field", key: field.key, parentKey: key });
      }
    }
  }
  for (const [index, field] of fields.entries()) {
    if (parentFor(index, fields.length) === null) {
      structure.push({ kind: "field", key: field.key, parentKey: null });
    }
  }
  return structure;
}

/**
 * Rich V2 reroll fixture: every Field kind, locked and unlocked, with bounded
 * number, declared choice, Sections, a nested Section, mixed Field/Section
 * ordering, `version > 1` and a `baseVersion` distinct from `version`. The
 * shape is canonical preorder and passes `validateDraftV2`. Structure and
 * values are derived from the Field registry so any registry variant stays
 * internally consistent.
 */
function makeRerollDraft(
  version = 5,
  baseVersion = 2,
  fields: DraftField[] = FIELDS,
): CharacterSheetDraftV2 {
  const values = valuesForFields(fields);
  return {
    schemaVersion: "2",
    draftId: "draft.reroll",
    sessionId: "session.reroll",
    baseVersion,
    version,
    mode: "pc",
    characterName:
      typeof values["character_name"] === "string"
        ? values["character_name"]
        : null,
    rulesContextId: "ctx.core.001",
    fields,
    sections: [
      { key: "core", title: "Core" },
      { key: "attributes", title: "Attributes" },
      { key: "belongings", title: "Belongings" },
    ],
    structure: structureForFields(fields),
    values,
    source: { sourceSheetId: "sheet.0001", sourceRunId: "run.0001" },
    confirmed: false,
  };
}

/**
 * Same Field registry, entirely different canonical placement of those Fields:
 * Sections first at Root, a different nesting, and the eligible Fields in the
 * opposite relative order. Still valid canonical preorder.
 */
function makeRerollDraftRestructured(): CharacterSheetDraftV2 {
  return {
    ...makeRerollDraft(),
    structure: [
      { kind: "section", key: "attributes", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "attributes" },
      { kind: "field", key: "agility", parentKey: "attributes" },
      { kind: "section", key: "core", parentKey: null },
      { kind: "section", key: "belongings", parentKey: "core" },
      { kind: "field", key: "armor", parentKey: "belongings" },
      { kind: "field", key: "strength", parentKey: "belongings" },
      { kind: "field", key: "epithet", parentKey: "core" },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "history", parentKey: null },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "field", key: "keepsakes", parentKey: null },
    ],
  };
}

/**
 * Registry order puts `weapon` before `strength` while canonical preorder
 * places `strength` first, so the two orders are distinguishable.
 */
function makeRegistryOrderedDraft(): CharacterSheetDraftV2 {
  const fields: DraftField[] = [
    { key: "character_name", label: "Name", type: "text", locked: false },
    {
      key: "weapon",
      label: "Weapon",
      type: "choice",
      options: ["sword", "bow", "staff"],
      locked: true,
    },
    {
      key: "strength",
      label: "Strength",
      type: "number",
      min: 1,
      max: 20,
      locked: true,
    },
  ];
  const values = valuesForFields(fields);
  return {
    schemaVersion: "2",
    draftId: "draft.reroll",
    sessionId: "session.reroll",
    baseVersion: 2,
    version: 5,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: "ctx.core.001",
    fields,
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "strength", parentKey: "core" },
      { kind: "field", key: "weapon", parentKey: "core" },
      { kind: "field", key: "character_name", parentKey: "core" },
    ],
    values,
    source: { sourceSheetId: "sheet.0001", sourceRunId: "run.0001" },
    confirmed: false,
  };
}

function makeNoGrammarDraft(): CharacterSheetDraftV2 {
  return makeRerollDraft(3, 1, [
    { key: "character_name", label: "Name", type: "text", locked: false },
    { key: "epithet", label: "Epithet", type: "text", locked: true },
    { key: "history", label: "History", type: "textarea", locked: true },
  ]);
}

function makeFixedNumberDraft(): CharacterSheetDraftV2 {
  return makeRerollDraft(4, 1, [
    { key: "character_name", label: "Name", type: "text", locked: false },
    {
      key: "constant",
      label: "Constant",
      type: "number",
      min: 7,
      max: 7,
      locked: true,
    },
  ]);
}

function makeSingleOptionDraft(): CharacterSheetDraftV2 {
  return makeRerollDraft(6, 2, [
    { key: "character_name", label: "Name", type: "text", locked: false },
    {
      key: "only",
      label: "Only",
      type: "choice",
      options: ["one"],
      locked: true,
    },
  ]);
}

function makeUnboundedNumberDraft(): CharacterSheetDraftV2 {
  return makeRerollDraft(4, 1, [
    { key: "character_name", label: "Name", type: "text", locked: false },
    { key: "half", label: "Half", type: "number", min: 1, locked: true },
    { key: "none", label: "None", type: "number", locked: true },
  ]);
}

function makeNoCharacterNameDraft(): CharacterSheetDraftV2 {
  const base = makeRerollDraft();
  const values = { ...base.values };
  delete values["character_name"];
  return { ...base, characterName: null, values };
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("rerollLockedDraftValuesV2 — eligible draw grammar", () => {
  it("1. rerolls a bounded locked number", () => {
    const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), "core-seed");
    const strength = draft.values.strength as number;
    expect(strength).toBeGreaterThanOrEqual(1);
    expect(strength).toBeLessThanOrEqual(20);
  });

  it("2. rerolls a locked choice", () => {
    const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), "core-seed");
    expect(["sword", "bow", "staff"]).toContain(draft.values.weapon);
  });

  it("3. reports both eligible keys in rerolledKeys", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect([...rerolledKeys].sort()).toEqual(["strength", "weapon"]);
  });

  it("4. preserves Field registry order in rerolledKeys", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).toEqual(["strength", "weapon"]);
  });

  it("5. does not reroll an unlocked number", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("agility");
    expect(draft.values.agility).toBe(14);
  });

  it("6. does not reroll an unlocked choice", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("armor");
    expect(draft.values.armor).toBe("leather");
  });

  it("7. leaves a locked text field unchanged", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("epithet");
    expect(draft.values.epithet).toBe("the Bold");
  });

  it("8. leaves a locked textarea field unchanged", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("history");
    expect(draft.values.history).toBe("Riverside");
  });

  it("9. leaves a locked checkbox field unchanged", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("veteran");
    expect(draft.values.veteran).toBe(true);
  });

  it("10. leaves a locked list field unchanged", () => {
    const { draft, rerolledKeys } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "core-seed",
    );
    expect(rerolledKeys).not.toContain("keepsakes");
    expect(draft.values.keepsakes).toEqual(["ring"]);
  });

  it("11. keeps every drawn value inside its grammar", () => {
    for (const seed of ["s-a", "s-b", "s-c", "s-d"]) {
      const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), seed);
      const strength = draft.values.strength as number;
      expect(strength).toBeGreaterThanOrEqual(1);
      expect(strength).toBeLessThanOrEqual(20);
      expect(["sword", "bow", "staff"]).toContain(draft.values.weapon);
    }
  });

  it("12. only ever selects a declared choice option", () => {
    for (const seed of ["c-a", "c-b", "c-c", "c-d", "c-e"]) {
      const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), seed);
      const weapon = draft.values.weapon as string;
      expect(["sword", "bow", "staff"]).toContain(weapon);
    }
  });

  it("does not reroll a locked number missing a bound", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeUnboundedNumberDraft(),
      "bounds-seed",
    );
    expect(rerolledKeys).toEqual([]);
  });
});

describe("rerollLockedDraftValuesV2 — determinism", () => {
  it("13. reproduces the same values for the same seed and draft", () => {
    const first = rerollLockedDraftValuesV2(makeRerollDraft(), "repro-seed");
    const second = rerollLockedDraftValuesV2(makeRerollDraft(), "repro-seed");
    expect(first.draft.values).toEqual(second.draft.values);
  });

  it("14. reproduces the same rerolledKeys for the same seed and draft", () => {
    const first = rerollLockedDraftValuesV2(makeRerollDraft(), "repro-seed");
    const second = rerollLockedDraftValuesV2(makeRerollDraft(), "repro-seed");
    expect(first.rerolledKeys).toEqual(second.rerolledKeys);
  });

  it("15. can produce different output for different seeds", () => {
    const draws = new Set(
      ["alpha", "beta", "gamma", "delta", "epsilon"].map((seed) => {
        const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), seed);
        return `${String(draft.values.strength)}:${String(draft.values.weapon)}`;
      }),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("16. does not mutate the input across repeated calls", () => {
    const draft = makeRerollDraft();
    const snapshot = JSON.stringify(draft);
    rerollLockedDraftValuesV2(draft, "first");
    rerollLockedDraftValuesV2(draft, "second");
    rerollLockedDraftValuesV2(draft, "first");
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("17. ignores structure placement and order for draw semantics", () => {
    const seed = "placement-seed";
    const base = makeRerollDraft();
    const restructured = makeRerollDraftRestructured();
    const fromBase = rerollLockedDraftValuesV2(base, seed);
    const fromRestructured = rerollLockedDraftValuesV2(restructured, seed);
    expect(fromBase.rerolledKeys).toEqual(fromRestructured.rerolledKeys);
    expect(fromBase.draft.values).toEqual(fromRestructured.draft.values);
  });

  it("17b. does not mutate either structure fixture", () => {
    const base = makeRerollDraft();
    const restructured = makeRerollDraftRestructured();
    const baseSnapshot = JSON.stringify(base);
    const restructuredSnapshot = JSON.stringify(restructured);
    rerollLockedDraftValuesV2(base, "placement-seed");
    rerollLockedDraftValuesV2(restructured, "placement-seed");
    expect(JSON.stringify(base)).toBe(baseSnapshot);
    expect(JSON.stringify(restructured)).toBe(restructuredSnapshot);
  });

  it("follows the fields registry order, not the structure order", () => {
    const draft = makeRegistryOrderedDraft();
    const structureOrder = draft.structure
      .filter((placement) => placement.kind === "field")
      .map((placement) => placement.key);
    expect(structureOrder).toEqual(["strength", "weapon", "character_name"]);
    const { rerolledKeys } = rerollLockedDraftValuesV2(draft, "order-seed");
    expect(rerolledKeys).toEqual(["weapon", "strength"]);
  });
});

describe("rerollLockedDraftValuesV2 — version lifecycle", () => {
  it("18. increments the version exactly once", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(5, 2),
      "lifecycle-seed",
    );
    expect(draft.version).toBe(6);
  });

  it("19. increments version 7 to 8", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(7, 3),
      "lifecycle-seed",
    );
    expect(draft.version).toBe(8);
  });

  it("20. leaves baseVersion unchanged", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(5, 2),
      "lifecycle-seed",
    );
    expect(draft.baseVersion).toBe(2);
  });

  it("21. keeps schemaVersion at 2", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.schemaVersion).toBe("2");
  });

  it("22. keeps confirmed false", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.confirmed).toBe(false);
  });

  it("23. keeps draftId unchanged", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.draftId).toBe("draft.reroll");
  });

  it("24. keeps sessionId unchanged", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.sessionId).toBe("session.reroll");
  });

  it("25. keeps mode unchanged", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.mode).toBe("pc");
  });

  it("26. keeps rulesContextId unchanged", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.rulesContextId).toBe("ctx.core.001");
  });

  it("27. preserves source", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "lifecycle-seed",
    );
    expect(draft.source).toEqual({
      sourceSheetId: "sheet.0001",
      sourceRunId: "run.0001",
    });
  });
});

describe("rerollLockedDraftValuesV2 — always a new version", () => {
  it("28. bumps the version when no Field has a draw grammar", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeNoGrammarDraft(),
      "empty-seed",
    );
    expect(draft.version).toBe(4);
  });

  it("29. returns a new top-level draft with no eligible Fields", () => {
    const input = makeNoGrammarDraft();
    const { draft } = rerollLockedDraftValuesV2(input, "empty-seed");
    expect(draft).not.toBe(input);
  });

  it("30. returns a new values object with no eligible Fields", () => {
    const input = makeNoGrammarDraft();
    const { draft } = rerollLockedDraftValuesV2(input, "empty-seed");
    expect(draft.values).not.toBe(input.values);
  });

  it("31. returns empty rerolledKeys with no eligible Fields", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeNoGrammarDraft(),
      "empty-seed",
    );
    expect(rerolledKeys).toEqual([]);
  });

  it("32. includes a min === max number in rerolledKeys", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeFixedNumberDraft(),
      "fixed-seed",
    );
    expect(rerolledKeys).toEqual(["constant"]);
  });

  it("33. still bumps the version for a min === max number", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeFixedNumberDraft(),
      "fixed-seed",
    );
    expect(draft.version).toBe(5);
  });

  it("33b. draws the constant value for a min === max number", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeFixedNumberDraft(),
      "fixed-seed",
    );
    expect(draft.values.constant).toBe(7);
  });

  it("34. includes a one-option choice in rerolledKeys", () => {
    const { rerolledKeys } = rerollLockedDraftValuesV2(
      makeSingleOptionDraft(),
      "single-seed",
    );
    expect(rerolledKeys).toEqual(["only"]);
  });

  it("35. still bumps the version for a one-option choice", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeSingleOptionDraft(),
      "single-seed",
    );
    expect(draft.version).toBe(7);
  });

  it("35b. draws the only declared option for a one-option choice", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeSingleOptionDraft(),
      "single-seed",
    );
    expect(draft.values.only).toBe("one");
  });
});

describe("rerollLockedDraftValuesV2 — references", () => {
  it("36. preserves the fields registry by exact reference", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.fields).toBe(draft.fields);
  });

  it("37. preserves sections by exact reference", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.sections).toBe(draft.sections);
  });

  it("38. preserves structure by exact reference", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.structure).toBe(draft.structure);
  });

  it("39. preserves source by exact reference", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.source).toBe(draft.source);
  });

  it("40. does not reuse the original values object", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.values).not.toBe(draft.values);
  });

  it("41. does not reuse the original draft object", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft).not.toBe(draft);
  });

  it("preserves element identity inside fields and structure", () => {
    const draft = makeRerollDraft();
    const result = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(result.draft.fields[1]).toBe(draft.fields[1]);
    expect(result.draft.structure[0]).toBe(draft.structure[0]);
    expect(result.draft.sections[0]).toBe(draft.sections[0]);
  });

  it("returns a fresh rerolledKeys array each call", () => {
    const draft = makeRerollDraft();
    const first = rerollLockedDraftValuesV2(draft, "ref-seed");
    const second = rerollLockedDraftValuesV2(draft, "ref-seed");
    expect(first.rerolledKeys).not.toBe(second.rerolledKeys);
    expect(first.rerolledKeys).toEqual(second.rerolledKeys);
  });
});

describe("rerollLockedDraftValuesV2 — characterName mirror", () => {
  it("42. keeps characterName mirrored to the character_name value", () => {
    const { draft } = rerollLockedDraftValuesV2(makeRerollDraft(), "name-seed");
    expect(draft.characterName).toBe("Aria Stone");
    expect(draft.characterName).toBe(draft.values["character_name"]);
  });

  it("43. does not reroll character_name merely because it could be locked", () => {
    const lockedName: DraftField[] = [
      { key: "character_name", label: "Name", type: "text", locked: true },
    ];
    const draft = makeRerollDraft(5, 2, lockedName);
    const { draft: next, rerolledKeys } = rerollLockedDraftValuesV2(
      draft,
      "name-locked-seed",
    );
    expect(rerolledKeys).toEqual([]);
    expect(next.values["character_name"]).toBe("Aria Stone");
    expect(next.characterName).toBe("Aria Stone");
  });

  it("43b. never rerolls a locked bounded-number character_name", () => {
    const hostileName: DraftField[] = [
      {
        key: "character_name",
        label: "Name",
        type: "number",
        min: 1,
        max: 6,
        locked: true,
      },
    ];
    const draft = makeRerollDraft(5, 2, hostileName);
    const { draft: next, rerolledKeys } = rerollLockedDraftValuesV2(
      draft,
      "hostile-name-seed",
    );
    expect(rerolledKeys).not.toContain("character_name");
    expect(next.values["character_name"]).toBe(draft.values["character_name"]);
    expect(next.characterName).toBe(draft.characterName);
    expect(() => validateDraftV2(next)).not.toThrow();
  });

  it("44. keeps characterName null when there is no character_name value", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeNoCharacterNameDraft(),
      "no-name-seed",
    );
    expect(draft.characterName).toBeNull();
    expect(draft.values["character_name"]).toBeUndefined();
  });

  it("does not invent a character name when none exists", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeNoCharacterNameDraft(),
      "no-name-seed",
    );
    expect(draft.characterName).not.toBe("Aria Stone");
  });
});

describe("rerollLockedDraftValuesV2 — confirmed guard", () => {
  function makeConfirmedRerollDraft(): CharacterSheetDraftV2 {
    return { ...makeRerollDraft(), confirmed: true };
  }

  it("45. rejects a confirmed draft with draft_confirmed", () => {
    expect(
      errorCodeOf(() =>
        rerollLockedDraftValuesV2(makeConfirmedRerollDraft(), "confirmed-seed"),
      ),
    ).toBe("draft_confirmed");
  });

  it("45b. throws DraftError", () => {
    expect(() =>
      rerollLockedDraftValuesV2(makeConfirmedRerollDraft(), "confirmed-seed"),
    ).toThrowError(DraftError);
  });

  it("46. does not bump the version on rejection", () => {
    const draft = makeConfirmedRerollDraft();
    try {
      rerollLockedDraftValuesV2(draft, "confirmed-seed");
    } catch {
      // expected
    }
    expect(draft.version).toBe(5);
    expect(draft.baseVersion).toBe(2);
  });

  it("47. does not change values on rejection", () => {
    const draft = makeConfirmedRerollDraft();
    const snapshot = JSON.stringify(draft.values);
    try {
      rerollLockedDraftValuesV2(draft, "confirmed-seed");
    } catch {
      // expected
    }
    expect(JSON.stringify(draft.values)).toBe(snapshot);
  });

  it("49. leaves the input draft deeply unchanged on rejection", () => {
    const draft = makeConfirmedRerollDraft();
    const snapshot = JSON.stringify(draft);
    try {
      rerollLockedDraftValuesV2(draft, "confirmed-seed");
    } catch {
      // expected
    }
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("rejects before any value is drawn", () => {
    const draft = makeConfirmedRerollDraft();
    let thrown: DraftError | undefined;
    try {
      rerollLockedDraftValuesV2(draft, "confirmed-seed");
    } catch (error) {
      thrown = error as DraftError;
    }
    expect(thrown?.code).toBe("draft_confirmed");
    expect(draft.values.strength).toBe(12);
  });
});

describe("rerollLockedDraftValuesV2 — canonical V2 validation", () => {
  it("50. produces a canonical V2 draft for a normal reroll", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeRerollDraft(),
      "valid-seed",
    );
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("51. produces a canonical V2 draft for a zero-eligible reroll", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeNoGrammarDraft(),
      "valid-seed",
    );
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("52. produces a canonical V2 draft for a min === max reroll", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeFixedNumberDraft(),
      "valid-seed",
    );
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("53. produces a canonical V2 draft for a one-option choice reroll", () => {
    const { draft } = rerollLockedDraftValuesV2(
      makeSingleOptionDraft(),
      "valid-seed",
    );
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("validates every result across many seeds", () => {
    for (const seed of ["v-a", "v-b", "v-c", "v-d", "v-e"]) {
      const result: DraftRerollResultV2 = rerollLockedDraftValuesV2(
        makeRerollDraft(),
        seed,
      );
      expect(() => validateDraftV2(result.draft)).not.toThrow();
    }
  });
});

describe("rerollLockedDraftValuesV2 — 4B1 integration", () => {
  it("uses the same version semantics as bumpDraftVersionV2", () => {
    const input = makeRerollDraft(5, 2);
    const rerolled = rerollLockedDraftValuesV2(input, "integration-seed");
    const expected = bumpDraftVersionV2(input);
    expect(rerolled.draft.version).toBe(expected.version);
    expect(rerolled.draft.baseVersion).toBe(expected.baseVersion);
  });

  it("increments once and never twice", () => {
    const input = makeRerollDraft(41, 7);
    const rerolled = rerollLockedDraftValuesV2(input, "integration-seed");
    const singleBump = bumpDraftVersionV2(input);
    expect(rerolled.draft.version).toBe(42);
    expect(rerolled.draft.version).toBe(singleBump.version);
    expect(rerolled.draft.version).not.toBe(
      bumpDraftVersionV2(singleBump).version,
    );
  });

  it("preserves baseVersion for a non-1 base", () => {
    const input = makeRerollDraft(12, 5);
    const rerolled = rerollLockedDraftValuesV2(input, "integration-seed");
    expect(rerolled.draft.baseVersion).toBe(5);
    expect(bumpDraftVersionV2(input).baseVersion).toBe(5);
  });
});

describe("reroll preserves explicit layout exactly (14.8)", () => {
  it("carries the layout reference through unchanged", () => {
    const base = makeRerollDraft();
    const input = { ...base, layout: defaultDraftLayoutV1(base) };
    const rerolled = rerollLockedDraftValuesV2(input, "layout-seed");
    expect(rerolled.draft.layout).toBe(input.layout);
  });
});
