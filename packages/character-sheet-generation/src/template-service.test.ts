import { describe, expect, it } from "vitest";
import type { CharacterSheetTemplate } from "@repo/character-sheet-template";
import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import {
  NPCGenerationRequestSchema,
  PCGenerationRequestSchema,
} from "./authoring.js";
import { CHARACTER_NAME_KEY } from "./final-construction.js";
import { generateTemplateBackedSheet } from "./template-service.js";

const pcTemplate: CharacterSheetTemplate = {
  schemaVersion: 1,
  mode: "pc",
  sections: [
    { key: "identity", title: "Identity" },
    { key: "attributes", title: "Attributes" },
  ],
  fields: [
    {
      label: "Character Name",
      category: "identity",
      kind: "text",
      sectionKey: "identity",
    },
    {
      label: "Background",
      category: "identity",
      kind: "textarea",
      sectionKey: "identity",
    },
    {
      label: "Vigor",
      category: "mechanical",
      kind: "number",
      sectionKey: "attributes",
      numericBounds: { min: 1, max: 10 },
    },
    {
      label: "Prowess",
      category: "mechanical",
      kind: "number",
      sectionKey: "attributes",
      numericBounds: { min: 1, max: 10 },
    },
  ],
};

const npcTemplate: CharacterSheetTemplate = {
  schemaVersion: 1,
  mode: "npc",
  sections: [{ key: "attributes", title: "Attributes" }],
  fields: [
    {
      label: "Character Name",
      category: "identity",
      kind: "text",
      sectionKey: "attributes",
    },
    {
      label: "Guard Rating",
      category: "mechanical",
      kind: "number",
      sectionKey: "attributes",
      numericBounds: { min: 1, max: 20 },
    },
  ],
};

function pcRequest(body: Record<string, unknown>) {
  return PCGenerationRequestSchema.parse({ mode: "pc", ...body });
}

function npcRequest(body: Record<string, unknown>) {
  return NPCGenerationRequestSchema.parse({
    mode: "npc",
    disposition: "enemy",
    threat: "ordinary",
    ...body,
  });
}

describe("generateTemplateBackedSheet", () => {
  it("builds a template-backed PC sheet with template-authored roster", async () => {
    const outcome = await generateTemplateBackedSheet({
      template: pcTemplate,
      request: pcRequest({
        characterName: "Vera Sage",
        mechanicalFields: [
          { label: "Vigor", initialValue: 7 },
          { label: "Prowess", initialValue: null },
        ],
        identityTraits: [{ label: "Background", value: "Harbormaster's kin" }],
      }),
      sheetId: "sheet.template.pc.0001",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.templateConflicts).toHaveLength(0);
    expect(outcome.overlayConflicts).toHaveLength(0);

    const sectionKeys = outcome.definition.definition.fields.map(
      (field) => field.canonicalKey,
    );
    expect(sectionKeys).toContain("character_name");
    expect(sectionKeys).toContain("background");
    expect(sectionKeys).toContain("vigor");
    expect(sectionKeys).toContain("prowess");

    expect(outcome.spec.values[CHARACTER_NAME_KEY]).toBe("Vera Sage");
    expect(outcome.spec.values["vigor"]).toBe(7);
    // Prowess has no explicit value -> blank, no invented number for a PC.
    expect("prowess" in outcome.spec.values).toBe(false);

    const vigor = outcome.definition.definition.fields.find(
      (f) => f.canonicalKey === "vigor",
    );
    expect(vigor!.provenance.origins).toEqual(["sheet-template", "gui"]);
  });

  it("fills a missing character name deterministically, no AI provider", async () => {
    const outcome = await generateTemplateBackedSheet({
      template: pcTemplate,
      request: pcRequest({}),
      sheetId: "sheet.template.pc.0002",
      seed: "seed-abc",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    const first = outcome.spec.values[CHARACTER_NAME_KEY];
    expect(typeof first).toBe("string");
    expect(String(first).length).toBeGreaterThan(0);

    const second = await generateTemplateBackedSheet({
      template: pcTemplate,
      request: pcRequest({}),
      sheetId: "sheet.template.pc.0002",
      seed: "seed-abc",
    });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") {
      return;
    }
    expect(second.spec.values[CHARACTER_NAME_KEY]).toBe(first);
  });

  it("accepts an explicit GUI name exactly without name-port fallback", async () => {
    const outcome = await generateTemplateBackedSheet({
      template: pcTemplate,
      request: pcRequest({
        characterName: "Exact Name",
        mechanicalFields: [],
        identityTraits: [],
      }),
      sheetId: "sheet.template.pc.0003",
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.spec.values[CHARACTER_NAME_KEY]).toBe("Exact Name");
  });

  it("rejects a template whose mode contradicts the request mode", async () => {
    const outcome = await generateTemplateBackedSheet({
      template: npcTemplate,
      request: pcRequest({}),
      sheetId: "sheet.template.pc.0004",
    });
    expect(outcome.kind).toBe("template_mode_mismatch");
  });

  it("keeps template numeric bounds for an NPC sheet and seeds a bounded NPC value", async () => {
    const makeOutcome = (seed: string) =>
      generateTemplateBackedSheet({
        template: npcTemplate,
        request: npcRequest({
          mechanicalFields: [],
          identityTraits: [],
        }),
        sheetId: "sheet.template.npc.0001",
        seed,
      });

    const outcome = await makeOutcome("template-seed-a");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    const guard = validGuardRatingValue(outcome);
    expect(guard).toBeGreaterThanOrEqual(1);
    expect(guard).toBeLessThanOrEqual(20);

    const repeated = await makeOutcome("template-seed-a");
    expect(repeated.kind).toBe("ok");
    if (repeated.kind !== "ok") {
      return;
    }
    expect(validGuardRatingValue(repeated)).toBe(guard);

    const varied = await makeOutcome("template-seed-b");
    expect(varied.kind).toBe("ok");
    if (varied.kind !== "ok") {
      return;
    }
    const variedGuard = validGuardRatingValue(varied);
    expect(variedGuard).toBeGreaterThanOrEqual(1);
    expect(variedGuard).toBeLessThanOrEqual(20);
  });

  it("surfaces visible overlay conflicts without failing the generation", async () => {
    const outcome = await generateTemplateBackedSheet({
      template: pcTemplate,
      request: pcRequest({
        mechanicalFields: [{ label: "Vigor", initialValue: 25 }],
      }),
      sheetId: "sheet.template.pc.0005",
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.overlayConflicts).toHaveLength(1);
    expect(outcome.overlayConflicts[0]!.code).toBe("INVALID_CONSTRAINT_VALUE");
  });
});

function validGuardRatingValue(outcome: {
  kind: "ok";
  spec: CharacterSheetSpec;
}): number {
  const value = outcome.spec.values["guard_rating"];
  if (typeof value !== "number") {
    throw new Error("guard_rating must be a number");
  }
  return value;
}
