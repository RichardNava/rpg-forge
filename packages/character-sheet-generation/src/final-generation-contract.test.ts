import { describe, expect, it } from "vitest";
import {
  FinalGenerationRequestV1Schema,
  buildFinalGenerationRequestV1,
  validateFinalGenerationRequestV1,
  CanonicalVisualStyleSchema,
  ThreatLevelSchema,
  PortraitConfigSchema,
  type FinalGenerationRequestV1,
  type CanonicalVisualStyle,
} from "./final-generation-contract.js";
import { type CharacterSheetDraftV2 } from "@repo/character-sheet-draft";

function makeConfirmedPcDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.test",
    sessionId: "session.test",
    baseVersion: 1,
    version: 3,
    mode: "pc",
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", min: 1, max: 20, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "core" },
    ],
    values: { character_name: "Aria", strength: 14 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

function makeConfirmedNpcDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.test",
    sessionId: "session.test",
    baseVersion: 1,
    version: 2,
    mode: "npc",
    characterName: "Goblin",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "hp", label: "HP", type: "number", min: 1, max: 100, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "hp", parentKey: "core" },
    ],
    values: { character_name: "Goblin", hp: 10 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

describe("FinalGenerationRequestV1Schema", () => {
  it("accepts a valid PC request with all canonical styles", () => {
    const pcDraft = makeConfirmedPcDraft();
    for (const style of CanonicalVisualStyleSchema.options) {
      const request = buildFinalGenerationRequestV1(pcDraft, {
        threat: null,
        visualStyle: style,
        instructions: "Some notes",
        portrait: { kind: "none" },
        seed: "test-seed-123",
      });
      const parsed = FinalGenerationRequestV1Schema.parse(request);
      expect(parsed.options.visualStyle).toBe(style);
      expect(parsed.options.threat).toBeNull();
      expect(parsed.options.portrait).toEqual({ kind: "none" });
      expect(parsed.seed).toBe("test-seed-123");
      expect(parsed.schemaVersion).toBe("1");
      expect(parsed.draft.mode).toBe("pc");
    }
  });

  it("accepts a valid NPC request with all canonical threat levels", () => {
    const npcDraft = makeConfirmedNpcDraft();
    for (const threat of ThreatLevelSchema.options) {
      const request = buildFinalGenerationRequestV1(npcDraft, {
        threat,
        visualStyle: "fantasy",
        instructions: null,
        portrait: { kind: "none" },
        seed: "npc-seed-456",
      });
      const parsed = FinalGenerationRequestV1Schema.parse(request);
      expect(parsed.options.threat).toBe(threat);
      expect(parsed.options.visualStyle).toBe("fantasy");
      expect(parsed.seed).toBe("npc-seed-456");
    }
  });

  it("rejects options.seed (unknown property)", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval",
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    // Manually add the forbidden property to test schema rejection
    const withOptionsSeed = {
      ...request,
      options: { ...request.options, seed: "should-fail" },
    };
    const result = FinalGenerationRequestV1Schema.safeParse(withOptionsSeed);
    expect(result.success).toBe(false);
  });

  it("rejects visualStyleIntent (unknown property)", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval",
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    const withIntent = {
      ...request,
      options: { ...request.options, visualStyleIntent: "should-fail" },
    };
    const result = FinalGenerationRequestV1Schema.safeParse(withIntent);
    expect(result.success).toBe(false);
  });

  it("rejects unknown visual style", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval-fantasy" as any, // old Web style, not canonical
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    const result = FinalGenerationRequestV1Schema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it("rejects unknown threat (old aliases)", () => {
    const npcDraft = makeConfirmedNpcDraft();
    for (const oldThreat of ["weak", "ordinary", "dangerous", "boss", "common", "veteran"]) {
      const request = buildFinalGenerationRequestV1(npcDraft, {
        threat: oldThreat as any,
        visualStyle: "fantasy",
        instructions: null,
        portrait: { kind: "none" },
        seed: "seed-1",
      });
      const result = FinalGenerationRequestV1Schema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  it("rejects portrait upload/url/ai", () => {
    const npcDraft = makeConfirmedNpcDraft();
    for (const portrait of [
      { kind: "upload", dataUrl: "data:..." },
      { kind: "url", url: "https://..." },
      { kind: "ai", prompt: "a goblin" },
    ] as const) {
      const request = buildFinalGenerationRequestV1(npcDraft, {
        threat: "medium",
        visualStyle: "fantasy",
        instructions: null,
        portrait: portrait as any,
        seed: "seed-1",
      });
      const result = FinalGenerationRequestV1Schema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  it("accepts only portrait { kind: 'none' }", () => {
    const npcDraft = makeConfirmedNpcDraft();
    const request = buildFinalGenerationRequestV1(npcDraft, {
      threat: "medium",
      visualStyle: "fantasy",
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    const result = FinalGenerationRequestV1Schema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it("requires seed (top-level, non-empty)", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval",
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    // Remove seed to test required
    const { seed: _seed, ...noSeed } = request;
    const result = FinalGenerationRequestV1Schema.safeParse(noSeed);
    expect(result.success).toBe(false);
  });

  it("seed appears exactly once (top-level only)", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval",
      instructions: null,
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    expect(Object.hasOwn(request, "seed")).toBe(true);
    expect(Object.hasOwn(request.options, "seed")).toBe(false);
  });

  it("PC draft with threat throws", () => {
    const pcDraft = makeConfirmedPcDraft();
    expect(() =>
      buildFinalGenerationRequestV1(pcDraft, {
        threat: "medium",
        visualStyle: "medieval",
        instructions: null,
        portrait: { kind: "none" },
        seed: "seed-1",
      }),
    ).toThrow("PC draft cannot have threat");
  });

  it("NPC draft without threat throws", () => {
    const npcDraft = makeConfirmedNpcDraft();
    expect(() =>
      buildFinalGenerationRequestV1(npcDraft, {
        threat: null,
        visualStyle: "fantasy",
        instructions: null,
        portrait: { kind: "none" },
        seed: "seed-1",
      }),
    ).toThrow("NPC draft requires threat");
  });

  it("unconfirmed draft throws", () => {
    const unconfirmed = { ...makeConfirmedPcDraft(), confirmed: false };
    expect(() =>
      buildFinalGenerationRequestV1(unconfirmed, {
        threat: null,
        visualStyle: "medieval",
        instructions: null,
        portrait: { kind: "none" },
        seed: "seed-1",
      }),
    ).toThrow("Draft must be confirmed");
  });

  it("preserves Draft values and blanks exactly", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "medieval",
      instructions: "test",
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    expect(request.draft.values).toEqual(pcDraft.values);
    expect(request.draft.fields).toEqual(pcDraft.fields);
    expect(request.draft.sections).toEqual(pcDraft.sections);
    expect(request.draft.structure).toEqual(pcDraft.structure);
    expect(request.draft.confirmed).toBe(true);
  });
});

describe("validateFinalGenerationRequestV1", () => {
  it("parses a valid request", () => {
    const pcDraft = makeConfirmedPcDraft();
    const request = buildFinalGenerationRequestV1(pcDraft, {
      threat: null,
      visualStyle: "fantasy",
      instructions: "hello",
      portrait: { kind: "none" },
      seed: "seed-1",
    });
    const parsed = validateFinalGenerationRequestV1(request);
    expect(parsed.seed).toBe("seed-1");
    expect(parsed.options.visualStyle).toBe("fantasy");
  });

  it("throws on invalid request", () => {
    expect(() =>
      validateFinalGenerationRequestV1({ schemaVersion: "1" }),
    ).toThrow();
  });
});