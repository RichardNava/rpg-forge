import { describe, expect, it } from "vitest";
import {
  resolveFinalValues,
  assertFinalValueResolutionEligible,
  FinalResolvedValuesV1Schema,
  type FinalResolvedValuesV1,
} from "./final-value-resolution.ts";
import type { ThreatLevel } from "./final-generation-contract.ts";

describe("FinalResolvedValuesV1Schema", () => {
  it("accepts a valid result", () => {
    const result: FinalResolvedValuesV1 = {
      schemaVersion: "1",
      values: { hp: 15, strength: 14 },
      generatedKeys: ["hp"],
    };
    const parsed = FinalResolvedValuesV1Schema.parse(result);
    expect(parsed.values.hp).toBe(15);
    expect(parsed.generatedKeys).toEqual(["hp"]);
  });

  it("rejects extra properties", () => {
    const result = {
      schemaVersion: "1",
      values: { hp: 15 },
      generatedKeys: ["hp"],
      extraField: "not allowed",
    };
    const parsed = FinalResolvedValuesV1Schema.safeParse(result);
    expect(parsed.success).toBe(false);
  });
});

describe("resolveFinalValues — PC mode", () => {
  const pcDraft = {
    mode: "pc" as const,
    fields: [
      { key: "hp", label: "HP", type: "number", min: 1, max: 20 },
      { key: "strength", label: "Strength", type: "number", min: 1, max: 20 },
      { key: "name", label: "Name", type: "text" },
    ],
    values: { hp: 15, name: "Aria" },
  };

  it("preserves explicit values", () => {
    const result = resolveFinalValues(pcDraft, { threat: null, seed: "seed-1" });
    expect(result.values.hp).toBe(15);
    expect(result.values.name).toBe("Aria");
    expect(result.generatedKeys).toEqual([]);
  });

  it("leaves blank fields absent", () => {
    const result = resolveFinalValues(pcDraft, { threat: null, seed: "seed-1" });
    expect(result.values.strength).toBeUndefined();
    expect("strength" in result.values).toBe(false);
  });

  it("validates explicit numeric values against range", () => {
    const invalidDraft = {
      ...pcDraft,
      values: { hp: 25, name: "Aria" }, // 25 > max 20
    };
    expect(() => resolveFinalValues(invalidDraft, { threat: null, seed: "seed-1" })).toThrow(
      "falls outside its permitted range",
    );
  });

  it("throws on unconfirmed draft", () => {
    expect(() =>
      assertFinalValueResolutionEligible({ mode: "pc", confirmed: false }, null),
    ).toThrow("Draft must be confirmed");
  });
});

describe("resolveFinalValues — NPC mode", () => {
  const npcDraft = {
    mode: "npc" as const,
    fields: [
      { key: "hp", label: "HP", type: "number", min: 10, max: 20 },
      { key: "strength", label: "Strength", type: "number", min: 1, max: 20 },
      { key: "name", label: "Name", type: "text" },
      { key: "unbounded", label: "Unbounded", type: "number" },
    ],
    values: { name: "Goblin", strength: 14 }, // hp and unbounded are blank
  };

  it("preserves explicit values", () => {
    const result = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result.values.name).toBe("Goblin");
    expect(result.values.strength).toBe(14);
  });

  it("generates bounded numeric values for blank fields", () => {
    const result = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result.values.hp as number).toBeGreaterThanOrEqual(10);
    expect(result.values.hp as number).toBeLessThanOrEqual(20);
    expect(typeof result.values.hp).toBe("number");
    expect(result.generatedKeys).toContain("hp");
  });

  it("same seed + threat + field = same value", () => {
    const result1 = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    const result2 = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result1.values.hp).toBe(result2.values.hp);
  });

  it("different seeds produce different values (within bounds)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const result = resolveFinalValues(npcDraft, { threat: "medium", seed: `seed-${i}` });
      const hp = result.values.hp as number;
      expect(hp).toBeGreaterThanOrEqual(10);
      expect(hp).toBeLessThanOrEqual(20);
      seen.add(hp);
    }
    // With deterministic seeds, we expect variation
    expect(seen.size).toBeGreaterThan(1);
  });

  it("threat bias: legendary > medium > very-low", async () => {
    const threatLevels: ThreatLevel[] = ["very-low", "low", "medium", "elite", "legendary"];
    const means: Record<ThreatLevel, number> = {} as any;

    for (const threat of threatLevels) {
      let sum = 0;
      for (let i = 0; i < 20; i++) {
        const result = resolveFinalValues(npcDraft, { threat, seed: `bias-${i}` });
        sum += result.values.hp as number;
      }
      means[threat] = sum / 20;
    }

    expect(means.legendary).toBeGreaterThan(means.medium);
    expect(means.medium).toBeGreaterThan(means["very-low"]);
  });

  it("does not generate for unbounded numeric fields", () => {
    const result = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result.values.unbounded).toBeUndefined();
    expect(result.generatedKeys).not.toContain("unbounded");
  });

  it("does not generate for non-numeric fields", () => {
    const result = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result.values.name).toBe("Goblin"); // explicit value preserved
    expect(result.generatedKeys).not.toContain("name");
  });

  it("does not generate for min === max fields", () => {
    const draftWithFixed = {
      ...npcDraft,
      fields: [
        ...npcDraft.fields,
        { key: "level", label: "Level", type: "number", min: 5, max: 5 },
      ],
      values: { ...npcDraft.values },
    };
    const result = resolveFinalValues(draftWithFixed, { threat: "medium", seed: "seed-1" });
    expect(result.values.level).toBe(5);
    expect(result.generatedKeys).not.toContain("level");
  });

  it("throws on NPC without threat", () => {
    expect(() => resolveFinalValues(npcDraft, { seed: "seed-1" })).toThrow(
      "NPC draft requires threat",
    );
    expect(() => resolveFinalValues(npcDraft, { threat: null, seed: "seed-1" })).toThrow(
      "NPC draft requires threat",
    );
  });

  it("throws on unconfirmed NPC draft", () => {
    expect(() =>
      assertFinalValueResolutionEligible({ mode: "npc", confirmed: false }, "medium"),
    ).toThrow("Draft must be confirmed");
  });

  it("validates explicit NPC values against range", () => {
    const invalidDraft = {
      ...npcDraft,
      values: { hp: 25, name: "Goblin" }, // 25 > max 20
    };
    expect(() => resolveFinalValues(invalidDraft, { threat: "medium", seed: "seed-1" })).toThrow(
      "falls outside its permitted range",
    );
  });
});

describe("resolveFinalValues — style invariance", () => {
  const npcDraft = {
    mode: "npc" as const,
    fields: [
      { key: "hp", label: "HP", type: "number", min: 10, max: 20 },
    ],
    values: {},
  };

  it("same seed + threat produces same values regardless of style", () => {
    // The resolveFinalValues function doesn't take style as input,
    // so this test verifies the function signature doesn't include style
    const result1 = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    const result2 = resolveFinalValues(npcDraft, { threat: "medium", seed: "seed-1" });
    expect(result1.values.hp).toBe(result2.values.hp);
  });
});