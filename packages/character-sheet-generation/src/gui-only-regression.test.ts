import { describe, expect, it } from "vitest";
import {
  NPCGenerationRequestSchema,
  PCGenerationRequestSchema,
  type CharacterSheetGenerationRequest,
} from "./authoring.js";
import {
  CHARACTER_NAME_KEY,
  FinalConstructionError,
  generateCharacterSheetSpec,
} from "./final-construction.js";
import type { Level3NamePort } from "./ports.js";
import {
  NormalizedSheetDefinitionSchema,
  type NormalizedSheetDefinition,
} from "./source-resolution.js";
import {
  FakeRulebookFieldDerivationPort,
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
} from "./test/fakes.js";
import { generateNormalizedSheet } from "./unified-service.js";

const RULEBOOK_HIT_POINTS_RANGE = { min: 1, max: 20 };

function pcRequest(
  body: Record<string, unknown>,
): CharacterSheetGenerationRequest {
  return PCGenerationRequestSchema.parse({ mode: "pc", ...body });
}

function npcRequest(
  body: Record<string, unknown>,
): CharacterSheetGenerationRequest {
  return NPCGenerationRequestSchema.parse({
    mode: "npc",
    disposition: "enemy",
    threat: "dangerous",
    ...body,
  });
}

class FixedNamePort implements Level3NamePort {
  readonly calls: Array<{ mode: string }> = [];

  constructor(private readonly name: string) {}

  async generateName(input: {
    mode: "pc" | "npc";
    system: string;
    user: string;
  }) {
    this.calls.push({ mode: input.mode });
    return this.name;
  }
}

function rulebookHitPointsResponse(): string {
  return JSON.stringify({
    schemaVersion: 1,
    fields: [
      {
        label: "Hit Points",
        category: "mechanical",
        permittedValueRange: RULEBOOK_HIT_POINTS_RANGE,
        evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
      },
    ],
  });
}

function rulebookDefinition(): NormalizedSheetDefinition {
  return NormalizedSheetDefinitionSchema.parse({
    schemaVersion: 1,
    mode: "pc",
    characterName: null,
    fields: [
      {
        canonicalKey: "attack",
        label: "Attack",
        category: "mechanical",
        permittedValueRange: { min: 1, max: 20 },
        provenance: {
          origins: ["rulebook"],
          ruleIds: [RULE_ATTACK_ID],
        },
      },
    ],
    overrides: [],
    conflicts: [],
  });
}

describe("Phase 14.7A1 — genuine GUI-only generation", () => {
  it("compiles a GUI-only PC sheet with null RulesContext, explicit sheetId, and zero derivation calls", async () => {
    const derivationPort = new FakeRulebookFieldDerivationPort();
    const namePort = new FixedNamePort("Aria Stone");

    const normalized = await generateNormalizedSheet(
      {
        request: pcRequest({
          mechanicalFields: [
            { label: "Strength", initialValue: 12 },
            { label: "Perception", initialValue: null },
          ],
          identityTraits: [{ label: "Homeland", value: "Riverside" }],
        }),
        context: null,
      },
      { derivationPort },
    );

    expect(normalized.kind).toBe("ok");
    expect(derivationPort.calls).toHaveLength(0);
    if (normalized.kind !== "ok") {
      throw new Error("expected ok outcome");
    }

    const spec = await generateCharacterSheetSpec({
      definition: normalized.result.definition,
      context: null,
      namePort,
      sheetId: "sheet.gui.pc.0001",
    });

    expect(spec.rulesContextId).toBeNull();
    expect(spec.metadata.id).toBe("sheet.gui.pc.0001");
    expect(Object.keys(spec.sourceMap)).toHaveLength(0);
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Aria Stone");
    expect(spec.values.strength).toBe(12);
    expect(spec.values.perception).toBeUndefined();
    expect(
      spec.fields.filter((field) => field.id === CHARACTER_NAME_KEY),
    ).toHaveLength(1);
  });

  it("compiles a GUI-only NPC sheet with null RulesContext and seeded threat-biased population", async () => {
    const derivationPort = new FakeRulebookFieldDerivationPort();
    const namePort = new FixedNamePort("Guard Captain");

    const normalized = await generateNormalizedSheet(
      {
        request: npcRequest({
          mechanicalFields: [{ label: "Hit Points", min: 10, max: 20 }],
          identityTraits: [{ label: "Post", value: "City gate" }],
        }),
        context: null,
      },
      { derivationPort },
    );

    expect(normalized.kind).toBe("ok");
    expect(derivationPort.calls).toHaveLength(0);
    if (normalized.kind !== "ok") {
      throw new Error("expected ok outcome");
    }

    const makeSpec = (seed: string) =>
      generateCharacterSheetSpec({
        definition: normalized.result.definition,
        context: null,
        namePort,
        sheetId: "sheet.gui.npc.0001",
        seed,
      });

    const spec = await makeSpec("npc-seed-a");

    expect(spec.mode).toBe("npc");
    expect(spec.rulesContextId).toBeNull();
    expect(spec.metadata.id).toBe("sheet.gui.npc.0001");
    expect(Object.keys(spec.sourceMap)).toHaveLength(0);
    // dangerous tier: value stays inside the permitted bounds and is seeded.
    const hitPoints = Number(spec.values.hit_points);
    expect(hitPoints).toBeGreaterThanOrEqual(10);
    expect(hitPoints).toBeLessThanOrEqual(20);
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Guard Captain");

    // same seed reproduces the same in-bounds value
    const sameSeed = await makeSpec("npc-seed-a");
    expect(sameSeed.values.hit_points).toBe(spec.values.hit_points);
    // a different seed may vary the eligible value
    const otherSeed = await makeSpec("npc-seed-b");
    expect(Number(otherSeed.values.hit_points)).toBeGreaterThanOrEqual(10);
    expect(Number(otherSeed.values.hit_points)).toBeLessThanOrEqual(20);
  });

  it("still compiles a rulebook-only sheet with the real analysis id and provenance", async () => {
    const context = makeRulesContext();
    const namePort = new FixedNamePort("Rulebook Recruit");

    const spec = await generateCharacterSheetSpec({
      definition: rulebookDefinition(),
      context,
      namePort,
    });

    expect(spec.rulesContextId).toBe(context.analysisId);
    expect(spec.metadata.id).toBe(context.analysisId);
    expect(spec.sourceMap.attack?.ruleIds).toEqual([RULE_ATTACK_ID]);
  });

  it("compiles a combined GUI + rulebook sheet with the same real analysis id and exact-key merge", async () => {
    const context = makeRulesContext();
    const derivationPort = new FakeRulebookFieldDerivationPort();
    derivationPort.script([rulebookHitPointsResponse()]);
    const namePort = new FixedNamePort("Combined Ranger");

    const normalized = await generateNormalizedSheet(
      {
        request: pcRequest({
          mechanicalFields: [
            { label: "Strength", initialValue: 12 },
            { label: "Hit Points", initialValue: 10 },
          ],
        }),
        context,
      },
      { derivationPort },
    );

    expect(normalized.kind).toBe("ok");
    expect(derivationPort.calls).toHaveLength(1);
    if (normalized.kind !== "ok") {
      throw new Error("expected ok outcome");
    }

    const hitPoints = normalized.result.definition.fields.find(
      (field) => field.canonicalKey === "hit_points",
    );
    expect(hitPoints).toBeDefined();
    expect(hitPoints?.provenance.origins).toEqual(["gui", "rulebook"]);
    expect(hitPoints?.provenance.ruleIds).toEqual([RULE_HIT_POINTS_ID]);

    const spec = await generateCharacterSheetSpec({
      definition: normalized.result.definition,
      context,
      namePort,
      sheetId: "sheet.combined.0001",
    });

    expect(spec.rulesContextId).toBe(context.analysisId);
    expect(spec.metadata.id).toBe("sheet.combined.0001");
    expect(spec.sourceMap.hit_points?.ruleIds).toEqual([RULE_HIT_POINTS_ID]);
    expect(spec.sourceMap.strength).toBeUndefined();
  });

  it("fails visibly when a rulebook-provenanced definition is compiled without a RulesContext", async () => {
    const namePort = new FixedNamePort("Doomed");

    await expect(
      generateCharacterSheetSpec({
        definition: rulebookDefinition(),
        context: null,
        namePort,
        sheetId: "sheet.invalid.0001",
      }),
    ).rejects.toBeInstanceOf(FinalConstructionError);
  });

  it("fails visibly when GUI-only construction omits the sheetId", async () => {
    const derivationPort = new FakeRulebookFieldDerivationPort();
    const namePort = new FixedNamePort("Unnamed");

    const normalized = await generateNormalizedSheet(
      {
        request: pcRequest({
          mechanicalFields: [{ label: "Strength", initialValue: 12 }],
        }),
        context: null,
      },
      { derivationPort },
    );
    expect(normalized.kind).toBe("ok");
    if (normalized.kind !== "ok") {
      throw new Error("expected ok outcome");
    }

    await expect(
      generateCharacterSheetSpec({
        definition: normalized.result.definition,
        context: null,
        namePort,
      }),
    ).rejects.toBeInstanceOf(FinalConstructionError);
  });
});
