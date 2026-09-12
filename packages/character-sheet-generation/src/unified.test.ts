import { describe, expect, it } from "vitest";
import {
  NPCGenerationRequestSchema,
  PCGenerationRequestSchema,
  type CharacterSheetGenerationRequest,
} from "./authoring.js";
import {
  resolveUnifiedSheetDefinition,
  type UnifiedSheetGenerationInput,
} from "./unified-generation.js";
import {
  generateNormalizedSheet,
  type UnifiedGenerationDeps,
} from "./unified-service.js";
import { SHEET_GENERATION_RETRIES } from "./model.js";
import type { GenerationConflict } from "./source-resolution.js";
import {
  FakeRulebookFieldDerivationPort,
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
} from "./test/fakes.js";

const HIT_POINTS_RANGE = { min: 1, max: 20 };

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
    threat: "boss",
    ...body,
  });
}

function rulebookHitPointsResponse(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    fields: [
      {
        label: "Hit Points",
        category: "mechanical",
        permittedValueRange: HIT_POINTS_RANGE,
        evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
        ...overrides,
      },
    ],
  });
}

function derivationConflicts(): GenerationConflict[] {
  return [
    {
      code: "FABRICATED_RULE_EVIDENCE",
      canonicalKey: "level",
      message:
        'Field "Level" references rule "rule-level", which does not exist in the rules context.',
      sourceLabels: ["Level"],
    },
  ];
}

describe("resolveUnifiedSheetDefinition", () => {
  it("merges an exact rulebook duplicate at the GUI position with merged provenance", () => {
    const result = resolveUnifiedSheetDefinition({
      mode: "pc",
      characterName: null,
      guiFields: [
        {
          canonicalKey: "hit_points",
          label: "Hit Points",
          category: "mechanical",
          explicitValue: 10,
          provenance: { origins: ["gui"] },
        },
      ],
      rulebookFields: [
        {
          canonicalKey: "hit_points",
          label: "Hit Points",
          category: "mechanical",
          permittedValueRange: HIT_POINTS_RANGE,
          provenance: {
            origins: ["rulebook"],
            ruleIds: [RULE_HIT_POINTS_ID],
          },
        },
      ],
    });

    expect(result.sourceResolution.conflicts).toEqual([]);
    expect(result.definition.fields).toHaveLength(1);
    const merged = result.definition.fields[0]!;
    expect(merged).toMatchObject({
      canonicalKey: "hit_points",
      category: "mechanical",
      explicitValue: 10,
      permittedValueRange: HIT_POINTS_RANGE,
    });
    expect(merged.provenance.origins).toEqual(["gui", "rulebook"]);
    expect(merged.provenance.ruleIds).toEqual([RULE_HIT_POINTS_ID]);
  });

  it("appends rulebook-only fields after GUI fields in derivation order", () => {
    const result = resolveUnifiedSheetDefinition({
      mode: "pc",
      characterName: null,
      guiFields: [
        {
          canonicalKey: "strength",
          label: "Strength",
          category: "mechanical",
          explicitValue: 14,
          provenance: { origins: ["gui"] },
        },
      ],
      rulebookFields: [
        {
          canonicalKey: "attack_roll",
          label: "Attack Roll",
          category: "mechanical",
          permittedValueRange: HIT_POINTS_RANGE,
          provenance: {
            origins: ["rulebook"],
            ruleIds: [RULE_ATTACK_ID],
          },
        },
        {
          canonicalKey: "homeland",
          label: "Homeland",
          category: "identity",
          explicitValue: "The wastes",
          provenance: {
            origins: ["rulebook"],
            ruleIds: [RULE_HIT_POINTS_ID],
          },
        },
      ],
    });

    expect(result.definition.fields.map((field) => field.canonicalKey)).toEqual(
      ["strength", "attack_roll", "homeland"],
    );
  });

  it("never merges mechanical Vigor with mechanical Constitution", () => {
    const result = resolveUnifiedSheetDefinition({
      mode: "pc",
      characterName: null,
      guiFields: [
        {
          canonicalKey: "vigor",
          label: "Vigor",
          category: "mechanical",
          explicitValue: 12,
          provenance: { origins: ["gui"] },
        },
      ],
      rulebookFields: [
        {
          canonicalKey: "constitution",
          label: "Constitution",
          category: "mechanical",
          permittedValueRange: HIT_POINTS_RANGE,
          provenance: {
            origins: ["rulebook"],
            ruleIds: [RULE_ATTACK_ID],
          },
        },
      ],
    });

    expect(result.definition.fields.map((field) => field.canonicalKey)).toEqual(
      ["vigor", "constitution"],
    );
    expect(result.definition.conflicts).toEqual([]);
  });

  it("surfaces derivation evidence conflicts before source-resolution conflicts", () => {
    const result = resolveUnifiedSheetDefinition({
      mode: "pc",
      characterName: null,
      sourceConflicts: derivationConflicts(),
      guiFields: [
        {
          canonicalKey: "strength",
          label: "Strength",
          category: "mechanical",
          permittedValueRange: { min: 1, max: 10 },
          provenance: { origins: ["gui"] },
        },
      ],
      rulebookFields: [
        {
          canonicalKey: "strength",
          label: "Strength",
          category: "mechanical",
          permittedValueRange: { min: 5, max: 25 },
          provenance: {
            origins: ["rulebook"],
            ruleIds: [RULE_ATTACK_ID],
          },
        },
      ],
    });

    expect(
      result.definition.conflicts.map((conflict) => conflict.code),
    ).toEqual([
      "FABRICATED_RULE_EVIDENCE",
      "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
    ]);
  });

  it("applies level-1 instructions on top of the level-2 merge", () => {
    const result = resolveUnifiedSheetDefinition({
      mode: "pc",
      characterName: null,
      guiFields: [
        {
          canonicalKey: "strength",
          label: "Strength",
          category: "mechanical",
          explicitValue: 14,
          provenance: { origins: ["gui"] },
        },
      ],
      instructions: [
        { op: "set_character_name", value: "Gruk the Reaver" },
        {
          op: "field",
          override: { op: "add", label: "Luck", initialValue: 7 },
        },
      ],
    });

    expect(result.definition.characterName).toBe("Gruk the Reaver");
    const luck = result.definition.fields.find(
      (field) => field.canonicalKey === "luck",
    );
    expect(luck).toMatchObject({
      category: "mechanical",
      explicitValue: 7,
      provenance: { origins: ["context-override"] },
    });
    expect(result.instructionResult.appliedInstructions).toHaveLength(2);
  });
});

describe("generateNormalizedSheet", () => {
  const deps = (
    port: FakeRulebookFieldDerivationPort,
  ): UnifiedGenerationDeps => ({
    derivationPort: port,
  });

  it("performs zero derivation calls without a RulesContext", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({
          mechanicalFields: [{ label: "Strength", initialValue: 14 }],
        }),
        context: null,
      },
      deps(port),
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(port.calls).toHaveLength(0);
    expect(outcome.derivation).toEqual({ calls: 0, fields: [], conflicts: [] });
    expect(
      outcome.result.definition.fields.map((field) => field.canonicalKey),
    ).toEqual(["strength"]);
  });

  it("derives, validates and merges rulebook fields for a READY context", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script([rulebookHitPointsResponse()]);
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({
          characterName: "Gruk",
          mechanicalFields: [
            { label: "Strength", initialValue: 14 },
            { label: "Hit Points", initialValue: 10 },
          ],
        }),
        context: makeRulesContext(),
      },
      deps(port),
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.derivation.calls).toBe(1);
    expect(outcome.derivation.conflicts).toEqual([]);
    expect(port.calls[0]?.user).toContain(RULE_HIT_POINTS_ID);
    const merged = outcome.result.definition.fields.find(
      (field) => field.canonicalKey === "hit_points",
    );
    expect(merged).toMatchObject({
      explicitValue: 10,
      permittedValueRange: HIT_POINTS_RANGE,
    });
    expect(merged?.provenance.origins).toEqual(["gui", "rulebook"]);
  });

  it("reports derivation_unavailable when the provider throws", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.failures.push("provider down");
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({ mechanicalFields: [{ label: "Strength" }] }),
        context: makeRulesContext(),
      },
      deps(port),
    );
    expect(outcome.kind).toBe("derivation_unavailable");
  });

  it("retries a malformed response and succeeds on the next attempt", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script(["not json at all", rulebookHitPointsResponse()]);
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({
          mechanicalFields: [{ label: "Hit Points", initialValue: 10 }],
        }),
        context: makeRulesContext(),
      },
      deps(port),
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.derivation.calls).toBe(2);
  });

  it("rejects the proposal when every attempt is malformed", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script(["bad", "also bad"]);
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({ mechanicalFields: [{ label: "Strength" }] }),
        context: makeRulesContext(),
      },
      deps(port),
    );
    expect(outcome.kind).toBe("invalid_proposal");
    if (outcome.kind === "invalid_proposal") {
      expect(outcome.message).toContain("JSON");
    }
  });

  it("rejects an inverted derived numeric range at the schema gate as invalid_proposal", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script([
      rulebookHitPointsResponse({ permittedValueRange: { min: 20, max: 1 } }),
      rulebookHitPointsResponse({ permittedValueRange: { min: 20, max: 1 } }),
    ]);
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({ mechanicalFields: [{ label: "Hit Points" }] }),
        context: makeRulesContext(),
      },
      deps(port),
    );

    expect(port.calls).toHaveLength(SHEET_GENERATION_RETRIES);
    expect(outcome.kind).toBe("invalid_proposal");
    if (outcome.kind === "invalid_proposal") {
      expect(outcome.message).toContain(
        "A numeric range max must be greater than or equal to min.",
      );
    }
  });

  it("turns fabricated evidence into a visible conflict without letting the field through", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script([
      rulebookHitPointsResponse({
        evidence: { ruleIds: ["rule-fabricated"] },
      }),
    ]);
    const outcome = await generateNormalizedSheet(
      {
        request: pcRequest({ mechanicalFields: [{ label: "Strength" }] }),
        context: makeRulesContext(),
      },
      deps(port),
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.derivation.fields).toHaveLength(0);
    expect(outcome.derivation.conflicts.map((c) => c.code)).toEqual([
      "FABRICATED_RULE_EVIDENCE",
    ]);
    expect(
      outcome.result.definition.fields.some(
        (f) => f.canonicalKey === "hit_points",
      ),
    ).toBe(false);
  });

  it("keeps NPC mechanical fields ranged and value-free through the service", async () => {
    const port = new FakeRulebookFieldDerivationPort();
    port.script([rulebookHitPointsResponse()]);
    const outcome = await generateNormalizedSheet(
      {
        request: npcRequest({
          mechanicalFields: [{ label: "Strength", min: 3, max: 18 }],
        }),
        context: makeRulesContext(),
      },
      deps(port),
    );

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    const npcDefinition = outcome.result.definition;
    expect(npcDefinition.npc).toEqual({ disposition: "enemy", threat: "boss" });
    for (const field of npcDefinition.fields) {
      expect(field).not.toHaveProperty("explicitValue");
    }
  });
});

describe("UnifiedSheetGenerationInput type guard", () => {
  it("accepts the documented input surface", () => {
    const input: UnifiedSheetGenerationInput = {
      mode: "pc",
      characterName: "Arya",
      guiFields: [],
      rulebookFields: [],
      sourceConflicts: [],
      instructions: [],
    };
    expect(input.mode).toBe("pc");
  });
});
