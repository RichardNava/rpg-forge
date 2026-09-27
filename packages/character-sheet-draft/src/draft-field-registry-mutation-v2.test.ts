import { describe, expect, it } from "vitest";
import {
  applyDraftFieldRegistryMutationWithExpectedVersionV2,
  DraftFieldRegistryMutationV2Schema,
  parseDraftFieldRegistryMutationV2,
  type DraftFieldRegistryMutationV2,
} from "./draft-field-registry-mutation-v2";
import { MAX_DRAFT_SURFACE_FIELDS } from "./draft-schema";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import { makeDraft as makeDraftV1 } from "./draft-fixture";
import { applyDraftMutation as applyDraftMutationV1 } from "./mutation-api";
import { DraftError } from "./errors";

function makeRichContentDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.registry",
    sessionId: "session.registry",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text",
        locked: false,
      },
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "veteran",
        label: "Veteran",
        type: "checkbox",
        locked: false,
      },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow"],
        locked: false,
      },
      { key: "loot", label: "Loot", type: "list", locked: false },
      { key: "secret", label: "Secret", type: "text", locked: true },
      { key: "curse", label: "Curse", type: "text", locked: true },
      { key: "quirk", label: "Quirk", type: "text", locked: false },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "attributes", title: "Attributes" },
      { key: "equipment", title: "Equipment" },
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
      { kind: "field", key: "secret", parentKey: null },
      { kind: "field", key: "curse", parentKey: null },
      { kind: "field", key: "quirk", parentKey: null },
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

function makeConfirmedRichContentDraft(): CharacterSheetDraftV2 {
  const draft = makeRichContentDraft();
  return validateDraftV2({ ...draft, confirmed: true });
}

function makeSingleFieldDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.only",
    sessionId: "session.only",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields: [{ key: "only", label: "Only", type: "text", locked: false }],
    sections: [],
    structure: [{ kind: "field", key: "only", parentKey: null }],
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeMaxSurfaceDraft(): CharacterSheetDraftV2 {
  const fields = Array.from(
    { length: MAX_DRAFT_SURFACE_FIELDS },
    (_, index) => ({
      key: `field_${index}`,
      label: `Field ${index}`,
      type: "text" as const,
      locked: false,
    }),
  );
  const structure = fields.map((field) => ({
    kind: "field" as const,
    key: field.key,
    parentKey: null,
  }));
  return {
    schemaVersion: "2",
    draftId: "draft.max",
    sessionId: "session.max",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields,
    sections: [],
    structure,
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function apply(
  draft: CharacterSheetDraftV2,
  mutation: DraftFieldRegistryMutationV2,
  expectedVersion = draft.version,
): CharacterSheetDraftV2 {
  return applyDraftFieldRegistryMutationWithExpectedVersionV2(
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

describe("draft-field-registry-mutation-v2 schema / parser", () => {
  it("parses a valid add_field text", () => {
    const parsed = parseDraftFieldRegistryMutationV2({
      op: "add_field",
      field: { key: "dexterity", label: "Dexterity", type: "text" },
    });
    expect(parsed.op).toBe("add_field");
  });

  it("parses a valid add_field number", () => {
    const parsed = parseDraftFieldRegistryMutationV2({
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
      },
    });
    expect(parsed.op).toBe("add_field");
  });

  it("parses a valid add_field choice", () => {
    const parsed = parseDraftFieldRegistryMutationV2({
      op: "add_field",
      field: {
        key: "background",
        label: "Background",
        type: "choice",
        options: ["scholar", "soldier"],
      },
    });
    expect(parsed.op).toBe("add_field");
  });

  it("defaults add_field locked to false", () => {
    const parsed = parseDraftFieldRegistryMutationV2({
      op: "add_field",
      field: { key: "dexterity", label: "Dexterity", type: "text" },
    });
    if (parsed.op === "add_field") {
      expect(parsed.field.locked).toBe(false);
    }
  });

  it("parses a valid remove_field", () => {
    const parsed = parseDraftFieldRegistryMutationV2({
      op: "remove_field",
      key: "notes",
    });
    expect(parsed.op).toBe("remove_field");
  });

  it("rejects an unknown op", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({ op: "explode" }),
    ).toThrowError(/invalid/);
  });

  it("rejects add_field without a field definition", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({ op: "add_field" }),
    ).toThrowError(DraftError);
  });

  it("rejects a malformed field", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "dexterity", type: "text" },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects invalid key syntax", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "bad key", label: "Bad", type: "text" },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects a whitespace-only label", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "dexterity", label: "   ", type: "text" },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects an invalid choice without options", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "background", label: "Background", type: "choice" },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects an invalid number min > max", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: {
          key: "dexterity",
          label: "Dexterity",
          type: "number",
          min: 20,
          max: 1,
        },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects an extra top-level property", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "dexterity", label: "Dexterity", type: "text" },
        extra: true,
      }),
    ).toThrowError(DraftError);
  });

  it("rejects an extra field property", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: {
          key: "dexterity",
          label: "Dexterity",
          type: "text",
          arbitrary: 1,
        },
      }),
    ).toThrowError(DraftError);
  });

  it("rejects expectedVersion inside the add payload", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "add_field",
        field: { key: "dexterity", label: "Dexterity", type: "text" },
        expectedVersion: 4,
      }),
    ).toThrowError(DraftError);
  });

  it("rejects expectedVersion inside the remove payload", () => {
    expect(() =>
      parseDraftFieldRegistryMutationV2({
        op: "remove_field",
        key: "notes",
        expectedVersion: 4,
      }),
    ).toThrowError(DraftError);
  });

  it("throws invalid_mutation from the parser", () => {
    let thrown: unknown;
    try {
      parseDraftFieldRegistryMutationV2({ op: "explode" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DraftError);
    if (thrown instanceof DraftError) {
      expect(thrown.code).toBe("invalid_mutation");
    }
  });

  it("does not mutate valid parser input", () => {
    const input = {
      op: "add_field" as const,
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text" as const,
        locked: false,
      },
    };
    const snapshot = JSON.stringify(input);
    parseDraftFieldRegistryMutationV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate rejected parser input", () => {
    const input = {
      op: "add_field",
      field: { key: "dexterity", label: "   ", type: "text" },
      extra: 1,
    } as unknown;
    const snapshot = JSON.stringify(input);
    expect(() => parseDraftFieldRegistryMutationV2(input)).toThrowError(
      DraftError,
    );
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("draft-field-registry-mutation-v2 add_field", () => {
  it("adds a field to the registry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.fields).toHaveLength(draft.fields.length + 1);
    expect(result.fields.some((field) => field.key === "dexterity")).toBe(true);
  });

  it("appends the new field as the last registry entry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.fields[result.fields.length - 1]?.key).toBe("dexterity");
  });

  it("creates exactly one field placement", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    const placements = result.structure.filter(
      (placement) =>
        placement.kind === "field" && placement.key === "dexterity",
    );
    expect(placements).toHaveLength(1);
  });

  it("places the new field at root", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    const placement = result.structure.find(
      (entry) => entry.kind === "field" && entry.key === "dexterity",
    );
    expect(placement).toEqual({
      kind: "field",
      key: "dexterity",
      parentKey: null,
    });
  });

  it("appends the placement as the final structure entry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.structure[result.structure.length - 1]).toEqual({
      kind: "field",
      key: "dexterity",
      parentKey: null,
    });
  });

  it("leaves existing structure order unchanged", () => {
    const draft = makeRichContentDraft();
    const before = JSON.stringify(draft.structure);
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(
      JSON.stringify(result.structure.slice(0, draft.structure.length)),
    ).toBe(before);
  });

  it("preserves existing placement objects by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    draft.structure.forEach((placement, index) => {
      expect(result.structure[index]).toBe(placement);
    });
  });

  it("preserves sections by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.sections).toBe(draft.sections);
  });

  it("preserves values by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.values).toBe(draft.values);
  });

  it("preserves characterName", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.characterName).toBe(draft.characterName);
  });

  it("preserves source provenance", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.source).toBe(draft.source);
  });

  it("produces a schema-valid result", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("bumps the version exactly once", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.version).toBe(draft.version + 1);
  });

  it("keeps baseVersion unchanged", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.baseVersion).toBe(draft.baseVersion);
  });

  it("does not mutate the input draft", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("does not mutate the mutation object", () => {
    const draft = makeRichContentDraft();
    const mutation = {
      op: "add_field" as const,
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text" as const,
        locked: false,
      },
    };
    const snapshot = JSON.stringify(mutation);
    apply(draft, mutation);
    expect(JSON.stringify(mutation)).toBe(snapshot);
  });

  it("rejects a duplicate field key with invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "strength",
            label: "Strength",
            type: "number",
            locked: false,
          },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a duplicate field even with an identical definition", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "strength",
            label: "Strength",
            type: "number",
            min: 1,
            max: 20,
            locked: false,
          },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a field key colliding with a section key", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: { key: "core", label: "Core", type: "text", locked: false },
        }),
      "invalid_mutation",
    );
  });

  it("rejects add when the surface is already full", () => {
    const draft = makeMaxSurfaceDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "overflow",
            label: "Overflow",
            type: "text",
            locked: false,
          },
        }),
      "surface_out_of_bounds",
    );
  });

  it("rejects a bad choice definition with invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "background",
            label: "Background",
            type: "choice",
            locked: false,
          },
        }),
      "invalid_mutation",
    );
  });

  it("rejects invalid numeric bounds with invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "dexterity",
            label: "Dexterity",
            type: "number",
            min: 20,
            max: 1,
            locked: false,
          },
        }),
      "invalid_mutation",
    );
  });
});

describe("draft-field-registry-mutation-v2 remove_field", () => {
  it("removes a field from the registry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(result.fields.some((field) => field.key === "veteran")).toBe(false);
  });

  it("removes exactly its field placement", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(
      result.structure.some(
        (placement) =>
          placement.kind === "field" && placement.key === "veteran",
      ),
    ).toBe(false);
    expect(result.structure).toHaveLength(draft.structure.length - 1);
  });

  it("removes a root field correctly", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "secret" });
    expect(result.structure).toEqual([
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "section", key: "attributes", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "notes", parentKey: "core" },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "section", key: "equipment", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "equipment" },
      { kind: "field", key: "loot", parentKey: "equipment" },
      { kind: "field", key: "curse", parentKey: null },
      { kind: "field", key: "quirk", parentKey: null },
    ]);
  });

  it("removes a field nested inside a section correctly", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "notes" });
    expect(result.structure).toEqual([
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "section", key: "attributes", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "section", key: "equipment", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "equipment" },
      { kind: "field", key: "loot", parentKey: "equipment" },
      { kind: "field", key: "secret", parentKey: null },
      { kind: "field", key: "curse", parentKey: null },
      { kind: "field", key: "quirk", parentKey: null },
    ]);
  });

  it("preserves the relative order of every remaining placement", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "weapon" });
    const expectedOrder = draft.structure
      .filter(
        (placement) =>
          !(placement.kind === "field" && placement.key === "weapon"),
      )
      .map((placement) => placement.key);
    expect(result.structure.map((placement) => placement.key)).toEqual(
      expectedOrder,
    );
  });

  it("preserves surviving placements by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "notes" });
    let resultIndex = 0;
    for (const placement of draft.structure) {
      if (placement.kind === "field" && placement.key === "notes") {
        continue;
      }
      expect(result.structure[resultIndex]).toBe(placement);
      resultIndex += 1;
    }
  });

  it("preserves sections by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(result.sections).toBe(draft.sections);
  });

  it("removes a stored value when present", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "secret" });
    expect(result.values.secret).toBeUndefined();
  });

  it("clones the values map only when a value was removed", () => {
    const draft = makeRichContentDraft();
    const withValue = apply(draft, { op: "remove_field", key: "secret" });
    expect(withValue.values).not.toBe(draft.values);
  });

  it("preserves the values map by reference when no value existed", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "curse" });
    expect(result.values).toBe(draft.values);
  });

  it("removing character_name removes its value", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "character_name" });
    expect(result.values.character_name).toBeUndefined();
  });

  it("removing character_name nulls the mirror", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "character_name" });
    expect(result.characterName).toBeNull();
  });

  it("removing another field preserves characterName", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(result.characterName).toBe("Aria");
  });

  it("allows removing a locked field", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "secret" });
    expect(result.fields.some((field) => field.key === "secret")).toBe(false);
  });

  it("produces a schema-valid result", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("bumps the version exactly once", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(result.version).toBe(draft.version + 1);
  });

  it("keeps baseVersion unchanged", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "veteran" });
    expect(result.baseVersion).toBe(draft.baseVersion);
  });

  it("does not mutate the input draft", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    apply(draft, { op: "remove_field", key: "veteran" });
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("does not mutate the mutation object", () => {
    const draft = makeRichContentDraft();
    const mutation = { op: "remove_field" as const, key: "veteran" };
    const snapshot = JSON.stringify(mutation);
    apply(draft, mutation);
    expect(JSON.stringify(mutation)).toBe(snapshot);
  });

  it("rejects an unknown field with surface_out_of_bounds", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "ghost" }),
      "surface_out_of_bounds",
    );
  });

  it("rejects removing the last remaining field", () => {
    const draft = makeSingleFieldDraft();
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "only" }),
      "surface_out_of_bounds",
    );
  });
});

describe("draft-field-registry-mutation-v2 concurrency precedence", () => {
  const addMutation: DraftFieldRegistryMutationV2 = {
    op: "add_field",
    field: {
      key: "dexterity",
      label: "Dexterity",
      type: "text",
      locked: false,
    },
  };

  it("rejects a lower expectedVersion with version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
  });

  it("rejects a higher expectedVersion with version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version + 1),
      "version_conflict",
    );
  });

  it("stale + confirmed add resolves to version_conflict", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
  });

  it("stale + duplicate add resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "add_field",
            field: {
              key: "strength",
              label: "Strength",
              type: "number",
              locked: false,
            },
          },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + section-key collision add resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "add_field",
            field: { key: "core", label: "Core", type: "text", locked: false },
          },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + unknown remove resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, { op: "remove_field", key: "ghost" }, draft.version - 1),
      "version_conflict",
    );
  });

  it("stale + last-field remove resolves to version_conflict", () => {
    const draft = makeSingleFieldDraft();
    expectDraftCode(
      () =>
        apply(draft, { op: "remove_field", key: "only" }, draft.version - 1),
      "version_conflict",
    );
  });

  it("matching version + confirmed add resolves to draft_confirmed", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(() => apply(draft, addMutation), "draft_confirmed");
  });

  it("matching version + confirmed remove resolves to draft_confirmed", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "veteran" }),
      "draft_confirmed",
    );
  });

  it("matching version + duplicate add resolves to invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "strength",
            label: "Strength",
            type: "number",
            locked: false,
          },
        }),
      "invalid_mutation",
    );
  });

  it("matching version + unknown remove resolves to surface_out_of_bounds", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "ghost" }),
      "surface_out_of_bounds",
    );
  });

  it("matching version + last-field remove resolves to surface_out_of_bounds", () => {
    const draft = makeSingleFieldDraft();
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "only" }),
      "surface_out_of_bounds",
    );
  });

  it("leaves the original draft unchanged on every rejected path", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
    expectDraftCode(
      () => apply(draft, { op: "remove_field", key: "ghost" }),
      "surface_out_of_bounds",
    );
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_field",
          field: {
            key: "strength",
            label: "Strength",
            type: "number",
            locked: false,
          },
        }),
      "invalid_mutation",
    );
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

describe("draft-field-registry-mutation-v2 structural invariants", () => {
  it("add produces exactly one root placement appended at the end", () => {
    const draft = makeRichContentDraft();
    const resultingPlacement = {
      kind: "field" as const,
      key: "dexterity",
      parentKey: null,
    };
    const expected: DraftPlacement[] = [...draft.structure, resultingPlacement];
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(result.structure).toEqual(expected);
  });

  it("add does not change any existing parentKey", () => {
    const draft = makeRichContentDraft();
    const parentsBefore = draft.structure.map(
      (placement) => placement.parentKey,
    );
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    result.structure
      .slice(0, draft.structure.length)
      .forEach((placement, index) => {
        expect(placement.parentKey).toBe(parentsBefore[index]);
      });
  });

  it("add leaves every section registry entry untouched", () => {
    const draft = makeRichContentDraft();
    const sectionsBefore = JSON.stringify(draft.sections);
    const result = apply(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "text",
        locked: false,
      },
    });
    expect(JSON.stringify(result.sections)).toBe(sectionsBefore);
  });

  it("remove leaves Section subtrees contiguous and valid", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "strength" });
    expect(result.sections).toBe(draft.sections);
    expect(
      result.structure.filter((placement) => placement.kind === "section"),
    ).toEqual(
      draft.structure.filter((placement) => placement.kind === "section"),
    );
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("remove leaves every surviving parentKey unchanged", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "weapon" });
    const surviving = draft.structure.filter(
      (placement) =>
        !(placement.kind === "field" && placement.key === "weapon"),
    );
    expect(result.structure.map((placement) => placement.parentKey)).toEqual(
      surviving.map((placement) => placement.parentKey),
    );
  });

  it("zero placements remain for a removed field in the preorder", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, { op: "remove_field", key: "notes" });
    expect(
      result.structure.some(
        (placement) => placement.kind === "field" && placement.key === "notes",
      ),
    ).toBe(false);
    expect(() => validateDraftV2(result)).not.toThrow();
  });
});

describe("draft-field-registry-mutation-v2 V1 parity", () => {
  it("adds the same field definition as V1", () => {
    const field = {
      key: "dexterity",
      label: "Dexterity",
      type: "number",
      min: 1,
      max: 20,
      locked: false,
    } as const;
    const v1Result = applyDraftMutationV1(makeDraftV1(), {
      op: "add_field",
      field,
    });
    const v2Result = apply(makeRichContentDraft(), { op: "add_field", field });
    expect(
      v1Result.fields.find(
        (entry: { key: string }) => entry.key === "dexterity",
      ),
    ).toEqual(field);
    expect(
      v2Result.fields.find(
        (entry: { key: string }) => entry.key === "dexterity",
      ),
    ).toEqual(field);
  });

  it("rejects a duplicate add with the same code as V1", () => {
    const field = {
      key: "strength",
      label: "Strength",
      type: "number" as const,
      locked: false,
    };
    expectDraftCode(
      () => applyDraftMutationV1(makeDraftV1(), { op: "add_field", field }),
      "invalid_mutation",
    );
    expectDraftCode(
      () => apply(makeRichContentDraft(), { op: "add_field", field }),
      "invalid_mutation",
    );
  });

  it("removes a field like V1", () => {
    const v1Result = applyDraftMutationV1(makeDraftV1(), {
      op: "remove_field",
      key: "veteran",
    });
    const v2Result = apply(makeRichContentDraft(), {
      op: "remove_field",
      key: "veteran",
    });
    expect(v1Result.fields.some((field) => field.key === "veteran")).toBe(
      false,
    );
    expect(v2Result.fields.some((field) => field.key === "veteran")).toBe(
      false,
    );
  });

  it("removes a stored value like V1", () => {
    const v1Result = applyDraftMutationV1(makeDraftV1(), {
      op: "remove_field",
      key: "veteran",
    });
    const v2Result = apply(makeRichContentDraft(), {
      op: "remove_field",
      key: "veteran",
    });
    expect(v1Result.values.veteran).toBeUndefined();
    expect(v2Result.values.veteran).toBeUndefined();
  });

  it("nulls the mirror when removing character_name like V1", () => {
    const v1Result = applyDraftMutationV1(makeDraftV1(), {
      op: "remove_field",
      key: "character_name",
    });
    const v2Result = apply(makeRichContentDraft(), {
      op: "remove_field",
      key: "character_name",
    });
    expect(v1Result.characterName).toBeNull();
    expect(v1Result.values.character_name).toBeUndefined();
    expect(v2Result.characterName).toBeNull();
    expect(v2Result.values.character_name).toBeUndefined();
  });

  it("allows removing a locked field like V1", () => {
    const v1Result = applyDraftMutationV1(makeDraftV1(), {
      op: "remove_field",
      key: "strength",
    });
    const v2Result = apply(makeRichContentDraft(), {
      op: "remove_field",
      key: "secret",
    });
    expect(v1Result.fields.some((field) => field.key === "strength")).toBe(
      false,
    );
    expect(v2Result.fields.some((field) => field.key === "secret")).toBe(false);
  });

  it("rejects last-field removal with the same code as V1", () => {
    const nearlyEmpty = applyDraftMutationV1(
      applyDraftMutationV1(
        applyDraftMutationV1(
          applyDraftMutationV1(makeDraftV1(), {
            op: "remove_field",
            key: "veteran",
          }),
          { op: "remove_field", key: "weapon" },
        ),
        { op: "remove_field", key: "homeland" },
      ),
      { op: "remove_field", key: "character_name" },
    );
    expectDraftCode(
      () =>
        applyDraftMutationV1(nearlyEmpty, {
          op: "remove_field",
          key: "strength",
        }),
      "surface_out_of_bounds",
    );
    expectDraftCode(
      () => apply(makeSingleFieldDraft(), { op: "remove_field", key: "only" }),
      "surface_out_of_bounds",
    );
  });
});
