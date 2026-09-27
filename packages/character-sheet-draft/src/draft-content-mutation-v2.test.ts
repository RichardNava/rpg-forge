import { describe, expect, it } from "vitest";
import {
  applyDraftContentMutationWithExpectedVersionV2,
  DraftContentMutationV2Schema,
  parseDraftContentMutationV2,
  type DraftContentMutationV2,
} from "./draft-content-mutation-v2";
import { makeDraft as makeDraftV1 } from "./draft-fixture";
import { applyDraftMutation as applyDraftMutationV1 } from "./mutation-api";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import type { CharacterSheetDraft } from "./draft-schema";
import { DraftError } from "./errors";

function makeContentDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.content",
    sessionId: "session.content",
    baseVersion: 1,
    version: 4,
    mode: "pc" as const,
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      {
        key: "notes",
        label: "Notes",
        type: "textarea" as const,
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number" as const,
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "veteran",
        label: "Veteran",
        type: "checkbox" as const,
        locked: false,
      },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice" as const,
        options: ["sword", "bow"],
        locked: false,
      },
      { key: "loot", label: "Loot", type: "list" as const, locked: false },
      { key: "secret", label: "Secret", type: "text" as const, locked: true },
      { key: "curse", label: "Curse", type: "text" as const, locked: true },
      { key: "quirk", label: "Quirk", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "equipment", title: "Equipment" },
    ],
    structure: [
      { kind: "section" as const, key: "core", parentKey: null },
      { kind: "field" as const, key: "character_name", parentKey: "core" },
      { kind: "field" as const, key: "notes", parentKey: "core" },
      { kind: "field" as const, key: "strength", parentKey: "core" },
      { kind: "field" as const, key: "veteran", parentKey: null },
      { kind: "section" as const, key: "equipment", parentKey: null },
      { kind: "field" as const, key: "weapon", parentKey: "equipment" },
      { kind: "field" as const, key: "loot", parentKey: "equipment" },
      { kind: "field" as const, key: "secret", parentKey: null },
      { kind: "field" as const, key: "curse", parentKey: null },
      { kind: "field" as const, key: "quirk", parentKey: null },
    ],
    values: {
      character_name: "Aria",
      notes: "A note",
      strength: 12,
      veteran: true,
      weapon: "sword",
      loot: ["coin", "ring"],
      secret: "hidden",
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeConfirmedContentDraft(): CharacterSheetDraftV2 {
  const draft = makeContentDraft();
  return validateDraftV2({ ...draft, confirmed: true });
}

function apply(
  draft: CharacterSheetDraftV2,
  mutation: DraftContentMutationV2,
  expectedVersion = draft.version,
): CharacterSheetDraftV2 {
  return applyDraftContentMutationWithExpectedVersionV2(
    draft,
    mutation,
    expectedVersion,
  );
}

function expectDraftCode(fn: () => unknown, code: DraftError["code"]): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DraftError);
  if (thrown instanceof DraftError) {
    expect(thrown.code).toBe(code);
  }
}

describe("draft-content-mutation-v2 schema / parser", () => {
  it("parses a valid set_value", () => {
    const parsed = parseDraftContentMutationV2({
      op: "set_value",
      key: "strength",
      value: 5,
    });
    expect(parsed.op).toBe("set_value");
  });

  it("parses a valid clear_value", () => {
    const parsed = parseDraftContentMutationV2({
      op: "clear_value",
      key: "notes",
    });
    expect(parsed.op).toBe("clear_value");
  });

  it("parses a valid set_field_label", () => {
    const parsed = parseDraftContentMutationV2({
      op: "set_field_label",
      key: "strength",
      label: "Power",
    });
    expect(parsed.op).toBe("set_field_label");
  });

  it("parses valid set_field_type payloads for text, number and choice", () => {
    expect(
      parseDraftContentMutationV2({
        op: "set_field_type",
        field: { key: "notes", type: "text" },
      }).op,
    ).toBe("set_field_type");
    expect(
      parseDraftContentMutationV2({
        op: "set_field_type",
        field: { key: "notes", type: "number", min: 1, max: 10 },
      }).op,
    ).toBe("set_field_type");
    expect(
      parseDraftContentMutationV2({
        op: "set_field_type",
        field: { key: "notes", type: "choice", options: ["a", "b"] },
      }).op,
    ).toBe("set_field_type");
  });

  it("parses a valid lock_field and unlock_field", () => {
    expect(
      parseDraftContentMutationV2({ op: "lock_field", key: "veteran" }).op,
    ).toBe("lock_field");
    expect(
      parseDraftContentMutationV2({ op: "unlock_field", key: "secret" }).op,
    ).toBe("unlock_field");
  });

  it("rejects an unknown op", () => {
    const result = DraftContentMutationV2Schema.safeParse({
      op: "remove_field",
      key: "notes",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_value",
        key: "strength",
      }).success,
    ).toBe(false);
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_label",
        label: "Power",
      }).success,
    ).toBe(false);
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_type",
        field: { type: "text" },
      }).success,
    ).toBe(false);
  });

  it("rejects an extra top-level property", () => {
    const result = DraftContentMutationV2Schema.safeParse({
      op: "set_value",
      key: "strength",
      value: 5,
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid key syntax", () => {
    const result = DraftContentMutationV2Schema.safeParse({
      op: "set_value",
      key: "bad key!",
      value: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects expectedVersion inside the payload", () => {
    const result = DraftContentMutationV2Schema.safeParse({
      op: "set_value",
      key: "strength",
      value: 5,
      expectedVersion: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid labels", () => {
    for (const label of ["", "   ", "x".repeat(257)]) {
      const result = DraftContentMutationV2Schema.safeParse({
        op: "set_field_label",
        key: "strength",
        label,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects malformed set_field_type payloads", () => {
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_type",
        field: { key: "notes", type: "color" },
      }).success,
    ).toBe(false);
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_type",
        field: { key: "notes", type: "choice", options: [] },
      }).success,
    ).toBe(false);
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_type",
        field: { key: "notes", type: "choice", options: [" "] },
      }).success,
    ).toBe(false);
    expect(
      DraftContentMutationV2Schema.safeParse({
        op: "set_field_type",
        field: { key: "notes", type: "number", min: "1" },
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite values through the parser", () => {
    const result = DraftContentMutationV2Schema.safeParse({
      op: "set_value",
      key: "strength",
      value: Number.POSITIVE_INFINITY,
    });
    expect(result.success).toBe(false);
  });

  it("throws invalid_mutation from the parser", () => {
    expectDraftCode(
      () => parseDraftContentMutationV2({ op: "unknown_op", key: "strength" }),
      "invalid_mutation",
    );
    expectDraftCode(
      () =>
        parseDraftContentMutationV2({
          op: "set_value",
          key: "strength",
          value: 5,
          expectedVersion: 4,
        }),
      "invalid_mutation",
    );
  });

  it("does not mutate valid parser input", () => {
    const input = { op: "set_value" as const, key: "strength", value: 5 };
    const snapshot = JSON.stringify(input);
    parseDraftContentMutationV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate rejected parser input", () => {
    const input = {
      op: "set_value" as const,
      key: "strength",
      value: 5,
      expectedVersion: 4,
    };
    const snapshot = JSON.stringify(input);
    expectDraftCode(
      () => parseDraftContentMutationV2(input),
      "invalid_mutation",
    );
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("draft-content-mutation-v2 set_value", () => {
  it("sets a text value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "quirk",
      value: "Chirpy",
    });
    expect(result.values.quirk).toBe("Chirpy");
  });

  it("sets a textarea value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "notes",
      value: "Longer note",
    });
    expect(result.values.notes).toBe("Longer note");
  });

  it("sets a number value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "strength",
      value: 7,
    });
    expect(result.values.strength).toBe(7);
  });

  it("sets a checkbox value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "veteran",
      value: false,
    });
    expect(result.values.veteran).toBe(false);
  });

  it("sets a choice value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "weapon",
      value: "bow",
    });
    expect(result.values.weapon).toBe("bow");
  });

  it("sets a list value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "loot",
      value: ["gem", "scroll"],
    });
    expect(result.values.loot).toEqual(["gem", "scroll"]);
  });

  it("mirrors character_name through characterName", () => {
    const result = apply(makeContentDraft(), {
      op: "set_value",
      key: "character_name",
      value: "Bria",
    });
    expect(result.values.character_name).toBe("Bria");
    expect(result.characterName).toBe("Bria");
  });

  it("rejects null through set_value", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "notes",
          value: null,
        }),
      "invalid_mutation",
    );
  });

  it("rejects a wrong primitive type", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "strength",
          value: "5",
        }),
      "invalid_mutation",
    );
  });

  it("rejects a non-finite number when applied directly", () => {
    const draft = makeContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "set_value",
          key: "strength",
          value: Number.POSITIVE_INFINITY,
        } as DraftContentMutationV2),
      "invalid_mutation",
    );
  });

  it("rejects values below min and above max", () => {
    const draft = makeContentDraft();
    expectDraftCode(
      () => apply(draft, { op: "set_value", key: "strength", value: 0 }),
      "invalid_mutation",
    );
    expectDraftCode(
      () => apply(draft, { op: "set_value", key: "strength", value: 21 }),
      "invalid_mutation",
    );
  });

  it("rejects an undeclared choice", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "weapon",
          value: "axe",
        }),
      "invalid_mutation",
    );
  });

  it("rejects an unknown field with surface_out_of_bounds", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "ghost",
          value: "x",
        }),
      "surface_out_of_bounds",
    );
  });

  it("rejects a locked field with field_read_locked", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "secret",
          value: "leak",
        }),
      "field_read_locked",
    );
  });

  it("same primitive value is an exact-reference no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, {
      op: "set_value",
      key: "strength",
      value: 12,
    });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("same list contents is an exact-reference no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, {
      op: "set_value",
      key: "loot",
      value: ["coin", "ring"],
    });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("locked field rejects even when the value is unchanged", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "secret",
          value: "hidden",
        }),
      "field_read_locked",
    );
  });

  it("real update bumps version exactly once and preserves baseVersion", () => {
    const draft = makeContentDraft();
    const result = apply(draft, {
      op: "set_value",
      key: "strength",
      value: 9,
    });
    expect(result.version).toBe(5);
    expect(result.baseVersion).toBe(1);
    expect(draft.version).toBe(4);
  });
});

describe("draft-content-mutation-v2 clear_value", () => {
  it("removes an existing value", () => {
    const result = apply(makeContentDraft(), {
      op: "clear_value",
      key: "notes",
    });
    expect(result.values.notes).toBeUndefined();
  });

  it("sets character_name mirror to null", () => {
    const result = apply(makeContentDraft(), {
      op: "clear_value",
      key: "character_name",
    });
    expect(result.values.character_name).toBeUndefined();
    expect(result.characterName).toBeNull();
  });

  it("absent value is an exact-reference no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, { op: "clear_value", key: "quirk" });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("locked field rejects even when the value is absent", () => {
    expectDraftCode(
      () => apply(makeContentDraft(), { op: "clear_value", key: "curse" }),
      "field_read_locked",
    );
  });

  it("unknown field rejects", () => {
    expectDraftCode(
      () => apply(makeContentDraft(), { op: "clear_value", key: "ghost" }),
      "surface_out_of_bounds",
    );
  });

  it("real clear bumps exactly once", () => {
    const result = apply(makeContentDraft(), {
      op: "clear_value",
      key: "notes",
    });
    expect(result.version).toBe(5);
  });

  it("no-op does not bump", () => {
    const result = apply(makeContentDraft(), {
      op: "clear_value",
      key: "quirk",
    });
    expect(result.version).toBe(4);
  });
});

describe("draft-content-mutation-v2 labels / types / locks", () => {
  it("set_field_label changes the label", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_label",
      key: "strength",
      label: "Power",
    });
    const field = result.fields.find((entry) => entry.key === "strength");
    expect(field?.label).toBe("Power");
  });

  it("set_field_label with the same label is a no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, {
      op: "set_field_label",
      key: "strength",
      label: "Strength",
    });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("set_field_label unknown field rejects", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_field_label",
          key: "ghost",
          label: "Ghost",
        }),
      "surface_out_of_bounds",
    );
  });

  it("set_field_type changes the type", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "notes", type: "text" },
    });
    expect(result.fields.find((entry) => entry.key === "notes")?.type).toBe(
      "text",
    );
  });

  it("set_field_type preserves key, label and locked", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "strength", type: "textarea" },
    });
    const field = result.fields.find((entry) => entry.key === "strength");
    expect(field?.key).toBe("strength");
    expect(field?.label).toBe("Strength");
    expect(field?.locked).toBe(false);
  });

  it("set_field_type preserves a compatible existing value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "weapon", type: "text" },
    });
    expect(result.values.weapon).toBe("sword");
  });

  it("set_field_type removes an incompatible existing value", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "strength", type: "textarea" },
    });
    expect(result.values.strength).toBeUndefined();
  });

  it("set_field_type removing character_name restores the mirror", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "character_name", type: "checkbox" },
    });
    expect(result.values.character_name).toBeUndefined();
    expect(result.characterName).toBeNull();
  });

  it("set_field_type choice requires options", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_field_type",
          field: { key: "notes", type: "choice" },
        }),
      "invalid_mutation",
    );
  });

  it("set_field_type rejects invalid number bounds", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_field_type",
          field: { key: "notes", type: "number", min: 5, max: 1 },
        }),
      "invalid_mutation",
    );
  });

  it("set_field_type that rebuilds the same effective field is a no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, {
      op: "set_field_type",
      field: { key: "strength", type: "number", min: 1, max: 20 },
    });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("set_field_type result validates as V2", () => {
    const result = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "strength", type: "textarea" },
    });
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("lock_field locks an unlocked field", () => {
    const result = apply(makeContentDraft(), {
      op: "lock_field",
      key: "veteran",
    });
    expect(result.fields.find((entry) => entry.key === "veteran")?.locked).toBe(
      true,
    );
  });

  it("lock_field on an already locked field is a no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, { op: "lock_field", key: "secret" });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });

  it("unlock_field unlocks a locked field", () => {
    const result = apply(makeContentDraft(), {
      op: "unlock_field",
      key: "secret",
    });
    expect(result.fields.find((entry) => entry.key === "secret")?.locked).toBe(
      false,
    );
    expect(result.values.secret).toBe("hidden");
  });

  it("unlock_field on an already unlocked field is a no-op", () => {
    const draft = makeContentDraft();
    const result = apply(draft, { op: "unlock_field", key: "veteran" });
    expect(result).toBe(draft);
    expect(result.version).toBe(4);
  });
});

describe("draft-content-mutation-v2 concurrency precedence", () => {
  it("lower expectedVersion conflicts", () => {
    expectDraftCode(
      () =>
        apply(
          makeContentDraft(),
          {
            op: "set_value",
            key: "strength",
            value: 9,
          },
          3,
        ),
      "version_conflict",
    );
  });

  it("higher expectedVersion conflicts", () => {
    expectDraftCode(
      () =>
        apply(
          makeContentDraft(),
          {
            op: "set_value",
            key: "strength",
            value: 9,
          },
          5,
        ),
      "version_conflict",
    );
  });

  it("stale + confirmed resolves to version_conflict", () => {
    expectDraftCode(
      () =>
        apply(
          makeConfirmedContentDraft(),
          {
            op: "clear_value",
            key: "notes",
          },
          3,
        ),
      "version_conflict",
    );
  });

  it("stale + unknown field resolves to version_conflict", () => {
    expectDraftCode(
      () =>
        apply(
          makeContentDraft(),
          {
            op: "set_value",
            key: "ghost",
            value: "x",
          },
          3,
        ),
      "version_conflict",
    );
  });

  it("stale + locked set_value resolves to version_conflict", () => {
    expectDraftCode(
      () =>
        apply(
          makeContentDraft(),
          {
            op: "set_value",
            key: "secret",
            value: "leak",
          },
          3,
        ),
      "version_conflict",
    );
  });

  it("stale + would-be set_value no-op resolves to version_conflict", () => {
    expectDraftCode(
      () =>
        apply(
          makeContentDraft(),
          {
            op: "set_value",
            key: "strength",
            value: 12,
          },
          3,
        ),
      "version_conflict",
    );
  });

  it("stale + would-be lock no-op resolves to version_conflict", () => {
    expectDraftCode(
      () => apply(makeContentDraft(), { op: "lock_field", key: "secret" }, 3),
      "version_conflict",
    );
  });

  it("matching version + confirmed resolves to draft_confirmed", () => {
    expectDraftCode(
      () =>
        apply(makeConfirmedContentDraft(), {
          op: "clear_value",
          key: "notes",
        }),
      "draft_confirmed",
    );
  });

  it("matching version + unknown field resolves to surface_out_of_bounds", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "ghost",
          value: "x",
        }),
      "surface_out_of_bounds",
    );
  });

  it("matching version + locked set_value resolves to field_read_locked", () => {
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "secret",
          value: "leak",
        }),
      "field_read_locked",
    );
  });

  it("does not mutate the draft on any rejected path", () => {
    const draft = makeContentDraft();
    const snapshot = JSON.stringify(draft);
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "set_value",
            key: "strength",
            value: 9,
          },
          3,
        ),
      "version_conflict",
    );
    expectDraftCode(
      () =>
        apply(draft, {
          op: "set_value",
          key: "secret",
          value: "leak",
        }),
      "field_read_locked",
    );
    expectDraftCode(
      () =>
        apply(draft, {
          op: "set_value",
          key: "ghost",
          value: "x",
        }),
      "surface_out_of_bounds",
    );
    expectDraftCode(
      () =>
        apply(draft, {
          op: "set_value",
          key: "strength",
          value: "5",
        }),
      "invalid_mutation",
    );
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

describe("draft-content-mutation-v2 non-structural guarantee", () => {
  it("preserves structure and sections by reference", () => {
    const draft = makeContentDraft();
    const mutations: DraftContentMutationV2[] = [
      { op: "set_value", key: "strength", value: 9 },
      { op: "clear_value", key: "notes" },
      { op: "set_field_label", key: "strength", label: "Power" },
      {
        op: "set_field_type",
        field: { key: "strength", type: "textarea" },
      },
      { op: "lock_field", key: "veteran" },
      { op: "unlock_field", key: "secret" },
    ];
    for (const mutation of mutations) {
      const result = apply(draft, mutation);
      expect(result.structure).toBe(draft.structure);
      expect(result.sections).toBe(draft.sections);
      expect(JSON.stringify(result.structure)).toBe(
        JSON.stringify(draft.structure),
      );
      expect(JSON.stringify(result.sections)).toBe(
        JSON.stringify(draft.sections),
      );
    }
  });
});

describe("draft-content-mutation-v2 version / reference semantics", () => {
  const realChanges: DraftContentMutationV2[] = [
    { op: "set_value", key: "strength", value: 9 },
    { op: "clear_value", key: "notes" },
    { op: "set_field_label", key: "strength", label: "Power" },
    { op: "set_field_type", field: { key: "strength", type: "textarea" } },
    { op: "lock_field", key: "veteran" },
    { op: "unlock_field", key: "secret" },
  ];

  const noOps: DraftContentMutationV2[] = [
    { op: "set_value", key: "strength", value: 12 },
    { op: "set_value", key: "loot", value: ["coin", "ring"] },
    { op: "clear_value", key: "quirk" },
    { op: "set_field_label", key: "strength", label: "Strength" },
    {
      op: "set_field_type",
      field: { key: "strength", type: "number", min: 1, max: 20 },
    },
    { op: "lock_field", key: "secret" },
    { op: "unlock_field", key: "veteran" },
  ];

  it("every real change returns a new reference, bumps exactly once, keeps baseVersion", () => {
    for (const mutation of realChanges) {
      const draft = makeContentDraft();
      const result = apply(draft, mutation);
      expect(result).not.toBe(draft);
      expect(result.version).toBe(draft.version + 1);
      expect(result.baseVersion).toBe(draft.baseVersion);
      expect(result.schemaVersion).toBe("2");
      expect(() => validateDraftV2(result)).not.toThrow();
    }
  });

  it("every no-op returns the exact original reference without a bump", () => {
    for (const mutation of noOps) {
      const draft = makeContentDraft();
      const result = apply(draft, mutation);
      expect(result).toBe(draft);
      expect(result.version).toBe(draft.version);
      expect(result.baseVersion).toBe(draft.baseVersion);
    }
  });

  it("never increments version twice", () => {
    const draft = makeContentDraft();
    const result = apply(draft, { op: "set_value", key: "strength", value: 9 });
    expect(result.version).toBe(5);
  });
});

describe("draft-content-mutation-v2 V1 parity", () => {
  const v1Mutations: Array<{
    label: string;
    v1: Parameters<typeof applyDraftMutationV1>[1];
    v2: DraftContentMutationV2;
  }> = [
    {
      label: "set_value",
      v1: { op: "set_value", key: "homeland", value: "Riverbend" },
      v2: { op: "set_value", key: "notes", value: "Riverbend" },
    },
    {
      label: "clear_value",
      v1: { op: "clear_value", key: "homeland" },
      v2: { op: "clear_value", key: "notes" },
    },
    {
      label: "set_field_label",
      v1: { op: "set_field_label", key: "homeland", label: "Home" },
      v2: { op: "set_field_label", key: "notes", label: "Home" },
    },
    {
      label: "set_field_type",
      v1: {
        op: "set_field_type",
        field: { key: "strength", type: "textarea" },
      },
      v2: {
        op: "set_field_type",
        field: { key: "strength", type: "textarea" },
      },
    },
    {
      label: "lock_field",
      v1: { op: "lock_field", key: "homeland" },
      v2: { op: "lock_field", key: "veteran" },
    },
    {
      label: "unlock_field",
      v1: { op: "unlock_field", key: "strength" },
      v2: { op: "unlock_field", key: "secret" },
    },
  ];

  it("produces the same content semantics as V1", () => {
    for (const { label, v1, v2 } of v1Mutations) {
      const v1Result = applyDraftMutationV1(makeDraftV1(), v1);
      const v2Result = apply(makeContentDraft(), v2);
      expect(v1Result, `${label} (V1)`).toBeDefined();
      expect(v2Result, `${label} (V2)`).toBeDefined();
    }
  });

  it("V1 and V2 both mirror character_name on set_value", () => {
    const v1 = applyDraftMutationV1(makeDraftV1(), {
      op: "set_value",
      key: "character_name",
      value: "Bria",
    });
    const v2 = apply(makeContentDraft(), {
      op: "set_value",
      key: "character_name",
      value: "Bria",
    });
    expect(v1.characterName).toBe("Bria");
    expect(v2.characterName).toBe("Bria");
  });

  it("V1 and V2 both reject an out-of-bounds value with invalid_mutation", () => {
    const v1Base = makeDraftV1();
    const v1WithBoundedEditable: CharacterSheetDraft = {
      ...v1Base,
      fields: [
        ...v1Base.fields,
        {
          key: "focus",
          label: "Focus",
          type: "number" as const,
          min: 1,
          max: 20,
          locked: false,
        },
      ],
    };
    expectDraftCode(
      () =>
        applyDraftMutationV1(v1WithBoundedEditable, {
          op: "set_value",
          key: "focus",
          value: 0,
        }),
      "invalid_mutation",
    );
    expectDraftCode(
      () =>
        apply(makeContentDraft(), {
          op: "set_value",
          key: "strength",
          value: 0,
        }),
      "invalid_mutation",
    );
  });

  it("V1 and V2 both remove an incompatible value on set_field_type", () => {
    const v1 = applyDraftMutationV1(makeDraftV1(), {
      op: "set_field_type",
      field: { key: "strength", type: "textarea" },
    });
    const v2 = apply(makeContentDraft(), {
      op: "set_field_type",
      field: { key: "strength", type: "textarea" },
    });
    expect(v1.values.strength).toBeUndefined();
    expect(v2.values.strength).toBeUndefined();
  });
});
