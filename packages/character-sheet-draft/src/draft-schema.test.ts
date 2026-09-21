import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_VERSION,
  CharacterSheetDraftSchema,
  DraftError,
  MAX_DRAFT_SURFACE_FIELDS,
  MAX_DRAFT_VALUES_FIELDS,
  draftForwardCompatibility,
  validateDraft,
} from "./index";
import { makeDraft } from "./draft-fixture";

describe("character sheet draft schema", () => {
  it("accepts the fixture draft", () => {
    expect(() => validateDraft(makeDraft())).not.toThrow();
  });

  it("parses through the canonical schema", () => {
    const draft = makeDraft();
    expect(CharacterSheetDraftSchema.parse(draft).draftId).toBe("draft.abc123");
  });

  it("rejects a values key outside the surface", () => {
    expect(() =>
      validateDraft(makeDraft({ values: { ghost: 1 } as never })),
    ).toThrowError(DraftError);
    try {
      validateDraft(makeDraft({ values: { ghost: 1 } as never }));
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftError);
      expect((error as DraftError).code).toBe("invalid_draft");
    }
  });

  it("rejects duplicate field keys", () => {
    const draft = makeDraft();
    const first = draft.fields[0];
    if (first === undefined) {
      throw new Error("fixture expected a first field");
    }
    draft.fields.push({ ...first, locked: false });
    expect(() => validateDraft(draft)).toThrowError(/must be unique/);
  });

  it("rejects a zero or negative version", () => {
    expect(() => validateDraft(makeDraft({ version: 0 }))).toThrowError(
      DraftError,
    );
    expect(() => validateDraft(makeDraft({ baseVersion: 0 }))).toThrowError(
      DraftError,
    );
  });

  it("rejects an out-of-budget surface", () => {
    const draft = makeDraft();
    const repeated = draft.fields.map((field) => field.key);
    const extra = Array.from(
      { length: MAX_DRAFT_SURFACE_FIELDS - draft.fields.length + 1 },
      (_, index) => ({
        key: `extra.${index}`,
        label: `Extra ${index}`,
        type: "text" as const,
        locked: false,
      }),
    );
    draft.fields.push(...extra);
    expect(() => validateDraft(draft)).toThrowError(DraftError);
  });

  it("rejects an out-of-budget values record", () => {
    const draft = makeDraft();
    const values: Record<string, string> = {};
    for (let index = 0; index < MAX_DRAFT_VALUES_FIELDS + 1; index += 1) {
      values[`extra.${index}`] = "x";
    }
    draft.fields.push(
      ...Array.from({ length: MAX_DRAFT_VALUES_FIELDS + 1 }, (_, index) => ({
        key: `extra.${index}`,
        label: `Extra ${index}`,
        type: "text" as const,
        locked: false,
      })),
    );
    draft.values = values as never;
    expect(() => validateDraft(draft)).toThrowError(DraftError);
  });

  it("enforces the characterName mirror invariant", () => {
    expect(() =>
      validateDraft(makeDraft({ characterName: "Someone Else" })),
    ).toThrowError(/must mirror/);
  });

  it("accepts a draft without a character_name value", () => {
    const draft = makeDraft();
    delete draft.values.character_name;
    draft.characterName = null;
    expect(() => validateDraft(draft)).not.toThrow();
  });

  it("rejects a non-string character_name value", () => {
    const draft = makeDraft();
    draft.values = { ...draft.values, character_name: 7 } as never;
    expect(() => validateDraft(draft)).toThrowError(/must be a string/);
  });

  it("rejects a choice field without options", () => {
    const draft = makeDraft();
    draft.fields = [
      { key: "flaw", label: "Flaw", type: "choice", locked: false },
    ];
    draft.values = {};
    draft.mode = "npc";
    expect(() => validateDraft(draft)).toThrowError(
      /A choice field must declare options/,
    );
  });

  it("rejects numeric bounds on a non-number field", () => {
    const draft = makeDraft();
    draft.fields = [
      {
        key: "strength",
        label: "Strength",
        type: "text",
        locked: false,
        min: 1,
      },
    ];
    draft.values = {};
    expect(() => validateDraft(draft)).toThrowError(
      /Only number fields may declare numeric bounds/,
    );
  });

  it("rejects a number field whose min exceeds max", () => {
    const draft = makeDraft();
    draft.fields = [
      {
        key: "strength",
        label: "Strength",
        type: "number",
        locked: false,
        min: 20,
        max: 1,
      },
    ];
    draft.values = {};
    expect(() => validateDraft(draft)).toThrowError(/min cannot exceed/);
  });

  it("accepts arbitrary nested section groupings and list values", () => {
    const draft = makeDraft();
    draft.fields.push({
      key: "backgrounds",
      label: "Backgrounds",
      type: "list",
      locked: false,
    });
    draft.sections = [
      { key: "attributes", title: "Attributes", fieldKeys: [] },
      {
        key: "physical",
        title: "Physical",
        parentKey: "attributes",
        fieldKeys: [draft.fields[0]!.key],
      },
      { key: "details", title: "Details", fieldKeys: ["backgrounds"] },
    ];
    draft.values.backgrounds = ["One", "Two"];
    expect(() => validateDraft(draft)).not.toThrow();
  });

  it("rejects section cycles and repeated field membership", () => {
    const draft = makeDraft();
    draft.sections = [
      {
        key: "one",
        title: "One",
        parentKey: "two",
        fieldKeys: ["character_name"],
      },
      {
        key: "two",
        title: "Two",
        parentKey: "one",
        fieldKeys: ["character_name"],
      },
    ];
    expect(() => validateDraft(draft)).toThrowError(
      /invalid field membership|invalid parent hierarchy/,
    );
  });

  it("rejects unsafe session and draft identities", () => {
    for (const identity of [
      { sessionId: ".." },
      { sessionId: "a/b" },
      { draftId: "a\\b" },
      { draftId: "" },
    ]) {
      expect(() => validateDraft(makeDraft(identity))).toThrowError(DraftError);
    }
  });

  it("rejects unsafe field keys", () => {
    const draft = makeDraft();
    draft.fields = [
      { key: "not/ok", label: "Nope", type: "text", locked: false },
    ];
    draft.values = {};
    expect(() => validateDraft(draft)).toThrowError(/safe canonical keys/);
  });

  it("reports the current forward-compatibility policy", () => {
    const policy = draftForwardCompatibility(makeDraft());
    expect(policy.current).toBe(true);
    expect(policy.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_VERSION);
    expect(policy.systemAgnostic).toBe(true);
    expect(policy.allExportableSystems).toBe(true);
    expect(policy.boundedKeys).toBe(true);
  });
});
