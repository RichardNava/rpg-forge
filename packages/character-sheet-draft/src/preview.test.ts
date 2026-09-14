import { describe, expect, it } from "vitest";
import { validateCharacterSheetSpecDomain } from "@repo/character-sheet-schema";
import {
  applyDraftMutation,
  DraftError,
  projectDraftToSpec,
  writebackDraftToSpec,
} from "./index";
import { makeDraft } from "./draft-fixture";

function baseSpec() {
  const draft = makeDraft();
  return projectDraftToSpec(draft);
}

describe("draft preview projection", () => {
  it("projects a PC draft into a renderable spec", () => {
    const spec = projectDraftToSpec(makeDraft());
    expect(spec.mode).toBe("player");
    expect(spec.rulesContextId).toBeNull();
    expect(spec.metadata.id).toBe("sheet.draft.draft.abc123");
    expect(spec.metadata.title).toBe("Aria Stone");
    const page = spec.pages[0];
    const section = spec.sections[0];
    if (page === undefined || section === undefined) {
      throw new Error("projection expected a page and section");
    }
    expect(page.layout.sectionIds).toEqual(["draft.section"]);
    expect(section.fieldIds).toHaveLength(5);
    expect(spec.fields.map((field) => field.id)).toEqual([
      "character_name",
      "strength",
      "homeland",
      "weapon",
      "veteran",
    ]);
    expect(spec.fields.find((field) => field.id === "weapon")?.type).toBe(
      "select",
    );
    expect(spec.values.strength).toBe(12);
    expect(spec.sourceMap).toEqual({});
  });

  it("projects an NPC draft with npc mode", () => {
    const draft = makeDraft({
      mode: "npc",
      characterName: "Guard Captain",
      values: { ...makeDraft().values, character_name: "Guard Captain" },
    });
    const spec = projectDraftToSpec(draft);
    expect(spec.mode).toBe("npc");
    expect(spec.metadata.title).toBe("Guard Captain");
  });

  it("falls back to an untitled projection when unnamed", () => {
    const draft = makeDraft();
    delete draft.values.character_name;
    draft.characterName = null;
    expect(projectDraftToSpec(draft).metadata.title).toBe("Untitled draft");
  });

  it("passes domain validation", () => {
    const spec = projectDraftToSpec(makeDraft());
    expect(validateCharacterSheetSpecDomain(spec)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("fails closed when a projected number value is null", () => {
    const draft = makeDraft({
      values: { ...makeDraft().values, strength: null },
    });
    try {
      projectDraftToSpec(draft);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("projection_invalid");
    }
  });
});

describe("draft writeback", () => {
  it("overlays edited values onto the generated base spec", () => {
    const base = baseSpec();
    const draft = makeDraft();
    const edited = applyDraftMutation(
      applyDraftMutation(draft, { op: "unlock_field", key: "strength" }),
      { op: "set_value", key: "strength", value: 18 },
    );
    const written = writebackDraftToSpec(edited, base);
    expect(written.values.strength).toBe(18);
    expect(written.metadata).toEqual(base.metadata);
    expect(written.fields).toEqual(base.fields);
    expect(written.sourceMap).toEqual(base.sourceMap);
    expect(validateCharacterSheetSpecDomain(written)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("drops draft keys absent from the base spec", () => {
    const base = baseSpec();
    const draft = makeDraft({
      values: { ...makeDraft().values, ghost: "x" } as never,
    });
    const written = writebackDraftToSpec(draft, base);
    expect(written.values.ghost).toBeUndefined();
    expect(written.values.strength).toBe(12);
  });

  it("fails closed when the overlay breaks domain validation", () => {
    const base = baseSpec();
    const draft = makeDraft({
      values: { ...makeDraft().values, strength: null },
    });
    try {
      writebackDraftToSpec(draft, base);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("writeback_invalid");
    }
  });
});
