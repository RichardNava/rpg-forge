import { describe, expect, it } from "vitest";
import {
  CharacterNameSchema,
  CharacterSheetGenerationRequestSchema,
  NPCGenerationRequestSchema,
  NPCThreatLevelSchema,
  PCGenerationRequestSchema,
  type NPCGenerationRequest,
} from "./authoring.js";

describe("CharacterSheetAuthoringMode", () => {
  it("accepts the private pc/npc modes", () => {
    expect(PCGenerationRequestSchema.safeParse({ mode: "pc" }).success).toBe(
      true,
    );
    expect(
      NPCGenerationRequestSchema.safeParse({
        mode: "npc",
        disposition: "ally",
      }).success,
    ).toBe(true);
  });

  it("rejects the compiled player/npc vocabulary", () => {
    const result = CharacterSheetGenerationRequestSchema.safeParse({
      mode: "player",
    });
    expect(result.success).toBe(false);
  });
});

describe("CharacterNameSchema", () => {
  it("maps blank names to null", () => {
    const result = CharacterNameSchema.parse("   ");
    expect(result).toBeNull();
  });

  it("trims and preserves supplied names", () => {
    expect(CharacterNameSchema.parse("  Arya Stark  ")).toBe("Arya Stark");
  });

  it("accepts null input", () => {
    expect(CharacterNameSchema.parse(null)).toBeNull();
  });

  it("rejects overlong names", () => {
    expect(CharacterNameSchema.safeParse("n".repeat(257)).success).toBe(false);
  });
});

describe("PCGenerationRequestSchema", () => {
  const minimalPc = { mode: "pc" };

  it("accepts a minimal request with safe defaults", () => {
    const request = PCGenerationRequestSchema.parse(minimalPc);
    expect(request.identityTraits).toEqual([]);
    expect(request.mechanicalFields).toEqual([]);
    expect(request.characterName).toBeUndefined();
  });

  it("accepts characterName as blank and normalizes it to null", () => {
    const request = PCGenerationRequestSchema.parse({
      ...minimalPc,
      characterName: "   ",
    });
    expect(request.characterName).toBeNull();
  });

  it("rejects contextInstructions beyond the bound", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      contextInstructions: "i".repeat(20_001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts identity traits with optional text values", () => {
    const request = PCGenerationRequestSchema.parse({
      ...minimalPc,
      identityTraits: [{ label: "Background", value: "Orphan" }],
    });
    expect(request.identityTraits).toHaveLength(1);
  });

  it("rejects duplicate identity trait labels", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      identityTraits: [{ label: "Notes" }, { label: "Notes" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts mechanical fields with an initial value or null", () => {
    const request = PCGenerationRequestSchema.parse({
      ...minimalPc,
      mechanicalFields: [
        { label: "Level", initialValue: 3 },
        { label: "Luck", initialValue: null },
      ],
    });
    expect(request.mechanicalFields.map((field) => field.label)).toEqual([
      "Level",
      "Luck",
    ]);
  });

  it("rejects duplicate mechanical field labels", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      mechanicalFields: [{ label: "HP" }, { label: "HP" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts both portrait kinds", () => {
    const uploaded = PCGenerationRequestSchema.parse({
      ...minimalPc,
      portrait: { kind: "upload", uploadRef: "r2:ref/abc" },
    });
    expect(uploaded.portrait).toEqual({
      kind: "upload",
      uploadRef: "r2:ref/abc",
    });

    const remote = PCGenerationRequestSchema.parse({
      ...minimalPc,
      portrait: { kind: "url", url: "https://example.com/portrait.png" },
    });
    expect(remote.portrait).toEqual({
      kind: "url",
      url: "https://example.com/portrait.png",
    });
  });

  it("rejects a malformed portrait url", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      portrait: { kind: "url", url: "not a url" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a portrait with an unknown kind", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      portrait: { kind: "clipboard", ref: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional free-form history", () => {
    const request = PCGenerationRequestSchema.parse({
      ...minimalPc,
      history: "Fled the vale after the harvest feast.",
    });
    expect(request.history).toMatch(/Fled the vale/);
  });

  it("rejects visual styles that are not kebab-case", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      visualStyle: "Fly_Dragon",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a rulebook key because association is run-scoped, not requested", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      rulebook: "src-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys beyond the defined surface", () => {
    const result = PCGenerationRequestSchema.safeParse({
      ...minimalPc,
      disposition: "ally",
    });
    expect(result.success).toBe(false);
  });
});

describe("NPCGenerationRequestSchema", () => {
  it("accepts an ally without a threat level", () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "ally",
    });
    expect(request.threat).toBeUndefined();
  });

  it("requires a threat level for enemies", () => {
    const result = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "enemy",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an enemy with a threat level", () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "enemy",
      threat: "dangerous",
    });
    expect(request.threat).toBe("dangerous");
  });

  it("forbids a threat level on allies", () => {
    const result = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "ally",
      threat: "weak",
    });
    expect(result.success).toBe(false);
  });

  it("rejects threat values outside the enum", () => {
    const result = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "enemy",
      threat: "demigod",
    });
    expect(result.success).toBe(false);
  });

  it("requires a disposition", () => {
    const result = NPCGenerationRequestSchema.safeParse({ mode: "npc" });
    expect(result.success).toBe(false);
  });

  it("requires NPC mechanical field min and max to be supplied together", () => {
    const bothResult = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "enemy",
      threat: "elite",
      mechanicalFields: [{ label: "Armor", min: 0, max: 20 }],
    });
    expect(bothResult.success).toBe(true);

    const minOnly = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "enemy",
      threat: "elite",
      mechanicalFields: [{ label: "Armor", min: 0 }],
    });
    expect(minOnly.success).toBe(false);
  });

  it("rejects NPC mechanical ranges where min exceeds max", () => {
    const result = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "enemy",
      threat: "elite",
      mechanicalFields: [{ label: "Armor", min: 20, max: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional characterName and trims it", () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "ally",
      characterName: "  Bogdan  ",
    });
    expect(request.characterName).toBe("Bogdan");
  });

  it("defaults trait and mechanical arrays to empty", () => {
    const request = NPCGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "ally",
    });
    expect(request.identityTraits).toEqual([]);
    expect(request.mechanicalFields).toEqual([]);
  });

  it("rejects PC-only surface on an NPC request", () => {
    const portrait = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "ally",
      portrait: { kind: "url", url: "https://example.com/x.png" },
    });
    expect(portrait.success).toBe(false);

    const history = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "ally",
      history: "Met the party at the crossroads.",
    });
    expect(history.success).toBe(false);
  });

  it("rejects a rulebook key because NPC association is run-scoped", () => {
    const result = NPCGenerationRequestSchema.safeParse({
      mode: "npc",
      disposition: "ally",
      rulebooks: ["src-1"],
    });
    expect(result.success).toBe(false);
  });
});

describe("CharacterSheetGenerationRequestSchema", () => {
  it("discriminates on mode across both variants", () => {
    const pc = CharacterSheetGenerationRequestSchema.parse({ mode: "pc" });
    expect(pc.mode).toBe("pc");
    expect(Object.hasOwn(pc, "disposition")).toBe(false);

    const npc = CharacterSheetGenerationRequestSchema.parse({
      mode: "npc",
      disposition: "enemy",
      threat: "boss",
    }) as NPCGenerationRequest;
    expect(npc.mode).toBe("npc");
    expect(npc.disposition).toBe("enemy");
  });

  it("rejects an unknown authoring mode", () => {
    const result = CharacterSheetGenerationRequestSchema.safeParse({
      mode: "companion",
    });
    expect(result.success).toBe(false);
  });

  it("exposes the full threat vocabulary", () => {
    expect(NPCThreatLevelSchema.options).toEqual([
      "weak",
      "ordinary",
      "dangerous",
      "elite",
      "boss",
    ]);
  });
});
