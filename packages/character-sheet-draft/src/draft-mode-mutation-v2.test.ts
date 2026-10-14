import { describe, expect, it } from "vitest";
import {
  applyDraftModeMutationWithExpectedVersionV2,
  DraftModeMutationV2Schema,
  parseDraftModeMutationV2,
  type DraftModeMutationV2,
} from "./draft-mode-mutation-v2";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";

function makePcDraft(): CharacterSheetDraftV2 {
  return validateDraftV2({
    schemaVersion: "2" as const,
    draftId: "draft.pc",
    sessionId: "session.pc",
    baseVersion: 1,
    version: 2,
    mode: "pc" as const,
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text" as const, locked: false },
      { key: "strength", label: "Strength", type: "number" as const, min: 1, max: 20, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section" as const, key: "core", parentKey: null },
      { kind: "field" as const, key: "character_name", parentKey: "core" },
      { kind: "field" as const, key: "strength", parentKey: "core" },
    ],
    values: { character_name: "Aria", strength: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  });
}

function makeNpcDraft(): CharacterSheetDraftV2 {
  return validateDraftV2({
    schemaVersion: "2" as const,
    draftId: "draft.npc",
    sessionId: "session.npc",
    baseVersion: 1,
    version: 3,
    mode: "npc" as const,
    characterName: "Goblin",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text" as const, locked: false },
      { key: "hp", label: "HP", type: "number" as const, min: 1, max: 100, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section" as const, key: "core", parentKey: null },
      { kind: "field" as const, key: "character_name", parentKey: "core" },
      { kind: "field" as const, key: "hp", parentKey: "core" },
    ],
    values: { character_name: "Goblin", hp: 10 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  });
}

describe("draft-mode-mutation-v2 schema", () => {
  it("accepts set_mode to pc", () => {
    const result = DraftModeMutationV2Schema.safeParse({ op: "set_mode", mode: "pc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.op).toBe("set_mode");
      expect(result.data.mode).toBe("pc");
    }
  });

  it("accepts set_mode to npc", () => {
    const result = DraftModeMutationV2Schema.safeParse({ op: "set_mode", mode: "npc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.op).toBe("set_mode");
      expect(result.data.mode).toBe("npc");
    }
  });

  it("rejects invalid mode", () => {
    const result = DraftModeMutationV2Schema.safeParse({ op: "set_mode", mode: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing mode", () => {
    const result = DraftModeMutationV2Schema.safeParse({ op: "set_mode" });
    expect(result.success).toBe(false);
  });
});

describe("parseDraftModeMutationV2", () => {
  it("parses valid set_mode pc", () => {
    const mutation = parseDraftModeMutationV2({ op: "set_mode", mode: "pc" });
    expect(mutation).toEqual({ op: "set_mode", mode: "pc" });
  });

  it("parses valid set_mode npc", () => {
    const mutation = parseDraftModeMutationV2({ op: "set_mode", mode: "npc" });
    expect(mutation).toEqual({ op: "set_mode", mode: "npc" });
  });

  it("throws on invalid mode with draftError", () => {
    expect(() => parseDraftModeMutationV2({ op: "set_mode", mode: "invalid" })).toThrow(
      DraftError,
    );
  });
});

describe("applyDraftModeMutationWithExpectedVersionV2 — set_mode", () => {
  it("switches PC to NPC and increments version", () => {
    const draft = makePcDraft();
    const mutation = { op: "set_mode" as const, mode: "npc" as const };
    const result = applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 2);
    expect(result.mode).toBe("npc");
    expect(result.version).toBe(3);
    expect(result.baseVersion).toBe(1);
    // All existing fields and values preserved
    expect(result.fields).toEqual(draft.fields);
    expect(result.values).toEqual(draft.values);
    expect(result.sections).toEqual(draft.sections);
    expect(result.structure).toEqual(draft.structure);
  });

  it("switches NPC to PC and increments version", () => {
    const draft = makeNpcDraft();
    const mutation = { op: "set_mode" as const, mode: "pc" as const };
    const result = applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 3);
    expect(result.mode).toBe("pc");
    expect(result.version).toBe(4);
    expect(result.baseVersion).toBe(1);
    // All existing fields and values preserved
    expect(result.fields).toEqual(draft.fields);
    expect(result.values).toEqual(draft.values);
    expect(result.sections).toEqual(draft.sections);
    expect(result.structure).toEqual(draft.structure);
  });

  it("returns same draft when mode unchanged", () => {
    const draft = makePcDraft();
    const mutation = { op: "set_mode" as const, mode: "pc" as const };
    const result = applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 2);
    expect(result).toBe(draft);
  });

  it("throws on version conflict", () => {
    const draft = makePcDraft();
    const mutation = { op: "set_mode" as const, mode: "npc" as const };
    expect(() =>
      applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 99),
    ).toThrow(DraftError);
  });

  it("throws on confirmed draft", () => {
    const draft = validateDraftV2({ ...makePcDraft(), confirmed: true });
    const mutation = { op: "set_mode" as const, mode: "npc" as const };
    expect(() =>
      applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 2),
    ).toThrow(DraftError);
  });

  it("preserves all draft content exactly (no confirmClear)", () => {
    const draft = makePcDraft();
    const mutation = { op: "set_mode" as const, mode: "npc" as const };
    const result = applyDraftModeMutationWithExpectedVersionV2(draft, mutation, 2);

    // Character name preserved
    expect(result.characterName).toBe("Aria");
    // All fields preserved
    expect(result.fields.map((f) => f.key)).toEqual(["character_name", "strength"]);
    // All values preserved
    expect(result.values).toEqual({ character_name: "Aria", strength: 12 });
    // Sections and structure preserved
    expect(result.sections).toEqual(draft.sections);
    expect(result.structure).toEqual(draft.structure);
    // Rules context preserved
    expect(result.rulesContextId).toBeNull();
    // Source preserved
    expect(result.source).toEqual(draft.source);
    // Confirmed status preserved (false)
    expect(result.confirmed).toBe(false);
  });
});