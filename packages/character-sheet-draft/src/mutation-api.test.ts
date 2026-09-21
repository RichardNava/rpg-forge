import { describe, expect, it } from "vitest";
import { applyDraftMutation, DraftError, validateDraft } from "./index";
import { makeDraft } from "./draft-fixture";

function unlocked(key: string) {
  return applyDraftMutation(makeDraft(), { op: "unlock_field", key });
}

describe("draft mutation api", () => {
  it("sets a value and mirrors the character name", () => {
    const next = applyDraftMutation(makeDraft(), {
      op: "set_value",
      key: "character_name",
      value: "Briar Vale",
    });
    expect(next.values.character_name).toBe("Briar Vale");
    expect(next.characterName).toBe("Briar Vale");
  });

  it("keeps the input snapshot immutable", () => {
    const original = makeDraft();
    const next = applyDraftMutation(original, {
      op: "set_value",
      key: "homeland",
      value: "Highmoors",
    });
    expect(next.values.homeland).toBe("Highmoors");
    expect(original.values.homeland).toBe("Riverside");
    expect(original.version).toBe(1);
    expect(next.version).toBe(1);
  });

  it("clears a value and nulls the mirrored name", () => {
    const next = applyDraftMutation(makeDraft(), {
      op: "clear_value",
      key: "character_name",
    });
    expect(next.values.character_name).toBeUndefined();
    expect(next.characterName).toBeNull();
  });

  it("rejects edits to a read-locked field", () => {
    try {
      applyDraftMutation(makeDraft(), {
        op: "set_value",
        key: "strength",
        value: 15,
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("field_read_locked");
    }
  });

  it("rejects clearing a read-locked field", () => {
    expect(() =>
      applyDraftMutation(makeDraft(), { op: "clear_value", key: "strength" }),
    ).toThrowError(DraftError);
  });

  it("rejects a wrong value type", () => {
    expect(() =>
      applyDraftMutation(makeDraft(), {
        op: "set_value",
        key: "homeland",
        value: 5,
      }),
    ).toThrowError(/expects a string value/);
  });

  it("rejects an out-of-bounds number", () => {
    expect(() =>
      applyDraftMutation(unlocked("strength"), {
        op: "set_value",
        key: "strength",
        value: 30,
      }),
    ).toThrowError(/at most 20/);
  });

  it("rejects an undeclared choice option", () => {
    expect(() =>
      applyDraftMutation(unlocked("weapon"), {
        op: "set_value",
        key: "weapon",
        value: "flail",
      }),
    ).toThrowError(/declared option/);
  });

  it("rejects null through set_value", () => {
    expect(() =>
      applyDraftMutation(makeDraft(), {
        op: "set_value",
        key: "homeland",
        value: null,
      }),
    ).toThrowError(/Use clear_value/);
  });

  it("rejects a key outside the surface", () => {
    try {
      applyDraftMutation(makeDraft(), {
        op: "set_value",
        key: "ghost",
        value: 1,
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("surface_out_of_bounds");
    }
  });

  it("rejects a structurally invalid mutation", () => {
    expect(() =>
      applyDraftMutation(makeDraft(), { op: "explode" }),
    ).toThrowError(DraftError);
    try {
      applyDraftMutation(makeDraft(), { op: "set_value", key: "strength" });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });

  it("unlocks a field before editing, then locks it again", () => {
    const draft = makeDraft();
    const unlocked = applyDraftMutation(draft, {
      op: "unlock_field",
      key: "strength",
    });
    const edited = applyDraftMutation(unlocked, {
      op: "set_value",
      key: "strength",
      value: 15,
    });
    expect(edited.values.strength).toBe(15);
    const relocked = applyDraftMutation(edited, {
      op: "lock_field",
      key: "strength",
    });
    expect(
      relocked.fields.find((field) => field.key === "strength")?.locked,
    ).toBe(true);
    expect(() =>
      applyDraftMutation(relocked, {
        op: "set_value",
        key: "strength",
        value: 5,
      }),
    ).toThrowError(DraftError);
  });

  it("produces a schema-valid snapshot for every accepted mutation", () => {
    const draft = makeDraft();
    const next = applyDraftMutation(draft, {
      op: "set_value",
      key: "homeland",
      value: "Highmoors",
    });
    expect(() => validateDraft(next)).not.toThrow();
  });

  it("adds a field to the surface", () => {
    const draft = makeDraft();
    const next = applyDraftMutation(draft, {
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    });
    expect(next.fields).toHaveLength(draft.fields.length + 1);
    expect(next.fields.some((field) => field.key === "dexterity")).toBe(true);
    expect(() => validateDraft(next)).not.toThrow();
  });

  it("adds a choice field with declared options", () => {
    const draft = makeDraft();
    const next = applyDraftMutation(draft, {
      op: "add_field",
      field: {
        key: "background",
        label: "Background",
        type: "choice",
        options: ["scholar", "soldier", "merchant"],
        locked: false,
      },
    });
    expect(next.fields.some((field) => field.key === "background")).toBe(true);
    expect(() => validateDraft(next)).not.toThrow();
  });

  it("rejects adding a field with an existing key", () => {
    try {
      applyDraftMutation(makeDraft(), {
        op: "add_field",
        field: {
          key: "strength",
          label: "Strength",
          type: "number",
          locked: false,
        },
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });

  it("rejects a structurally invalid field on add", () => {
    try {
      applyDraftMutation(makeDraft(), {
        op: "add_field",
        field: {
          key: "bad_choice",
          label: "Bad Choice",
          type: "choice",
          locked: false,
        },
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });

  it("removes a field and its value", () => {
    const draft = makeDraft();
    const next = applyDraftMutation(draft, {
      op: "remove_field",
      key: "veteran",
    });
    expect(next.fields.some((field) => field.key === "veteran")).toBe(false);
    expect(next.values.veteran).toBeUndefined();
    expect(() => validateDraft(next)).not.toThrow();
  });

  it("removing the character_name field nulls the mirrored name", () => {
    const draft = makeDraft();
    const next = applyDraftMutation(draft, {
      op: "remove_field",
      key: "character_name",
    });
    expect(next.fields.some((field) => field.key === "character_name")).toBe(
      false,
    );
    expect(next.characterName).toBeNull();
    expect(() => validateDraft(next)).not.toThrow();
  });

  it("refuses to remove the last remaining field", () => {
    const draft = applyDraftMutation(makeDraft(), {
      op: "remove_field",
      key: "veteran",
    });
    const nearlyEmpty = applyDraftMutation(draft, {
      op: "remove_field",
      key: "weapon",
    });
    const stripped = applyDraftMutation(nearlyEmpty, {
      op: "remove_field",
      key: "homeland",
    });
    const stripped2 = applyDraftMutation(stripped, {
      op: "remove_field",
      key: "character_name",
    });
    try {
      applyDraftMutation(stripped2, {
        op: "remove_field",
        key: "strength",
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("surface_out_of_bounds");
    }
  });

  it("rejects removing an unknown key", () => {
    try {
      applyDraftMutation(makeDraft(), {
        op: "remove_field",
        key: "ghost",
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("surface_out_of_bounds");
    }
  });

  it("edits labels, types and section membership without changing field keys", () => {
    const draft = makeDraft();
    const renamed = applyDraftMutation(draft, {
      op: "set_field_label",
      key: "strength",
      label: "Fuerza",
    });
    const typed = applyDraftMutation(renamed, {
      op: "set_field_type",
      field: { key: "strength", type: "number", min: 0, max: 5 },
    });
    const sectioned = applyDraftMutation(typed, {
      op: "add_section",
      section: { key: "attributes", title: "Atributos", fieldKeys: [] },
    });
    const moved = applyDraftMutation(sectioned, {
      op: "move_field",
      key: "strength",
      sectionKey: "attributes",
    });
    expect(
      moved.fields.find((field) => field.key === "strength"),
    ).toMatchObject({
      label: "Fuerza",
      type: "number",
      min: 0,
      max: 5,
    });
    expect(moved.sections).toEqual([
      { key: "attributes", title: "Atributos", fieldKeys: ["strength"] },
    ]);
  });

  it("reparents a section and restores it to the root", () => {
    const draft = makeDraft({
      sections: [
        { key: "attributes", title: "Attributes", fieldKeys: [] },
        { key: "physical", title: "Physical", fieldKeys: ["strength"] },
      ],
    });
    const nested = applyDraftMutation(draft, {
      op: "reparent_section",
      key: "physical",
      parentKey: "attributes",
    });
    expect(nested.sections?.[1]?.parentKey).toBe("attributes");
    const root = applyDraftMutation(nested, {
      op: "reparent_section",
      key: "physical",
      parentKey: null,
    });
    expect(root.sections?.[1]?.parentKey).toBeUndefined();
  });
});
