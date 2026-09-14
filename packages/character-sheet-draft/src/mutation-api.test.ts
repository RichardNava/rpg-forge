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
});
