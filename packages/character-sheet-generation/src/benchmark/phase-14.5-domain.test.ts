import { describe, expect, it } from "vitest";
import {
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import type { CharacterSheetGenerationRequest } from "../authoring.js";
import {
  generateCharacterSheetSpec,
  CHARACTER_NAME_KEY,
  FinalConstructionError,
  type FinalConstructionFailure,
  type GenerateCharacterSheetSpecInput,
} from "../final-construction.js";
import type { CalculationCandidate } from "../intermediate.js";
import type { ProposedGenerationInstruction } from "../instructions.js";
import type { Level3NamePort } from "../ports.js";
import type { RulebookDerivedDefinition } from "../rulebook-derivation.js";
import {
  NormalizedSheetDefinitionSchema,
  type NormalizedSheetDefinition,
} from "../source-resolution.js";
import {
  generateNormalizedSheet,
  type UnifiedGenerationDeps,
} from "../unified-service.js";
import type { UnifiedSheetGenerationResult } from "../unified-generation.js";
import {
  FakeRulebookFieldDerivationPort,
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
} from "../test/fakes.js";

const baseContext = makeRulesContext();

let nameSeed = 0;
class BenchmarkNamePort implements Level3NamePort {
  calls = 0;
  script: Array<string | "THROW"> = [];

  scriptWith(next: readonly (string | "THROW")[]) {
    this.script = [...next];
    return this;
  }

  async generateName(): Promise<string> {
    this.calls += 1;
    const next = this.script.shift();
    if (next === undefined) {
      return `Benchmark Hero ${(nameSeed += 1)}`;
    }
    if (next === "THROW") {
      throw new Error("name provider down");
    }
    return next;
  }
}

interface Pipeline {
  request: CharacterSheetGenerationRequest;
  context?: RulesContext | null;
  derivation?: readonly RulebookDerivedDefinition["fields"][number][];
  instructions?: readonly ProposedGenerationInstruction[];
  calculations?: readonly CalculationCandidate[];
  outputLocale?: string;
  presentation?: GenerateCharacterSheetSpecInput["presentation"];
  namePort?: BenchmarkNamePort;
  seed?: string;
}

async function runPipeline(input: Pipeline): Promise<{
  definition: NormalizedSheetDefinition;
  result: UnifiedSheetGenerationResult;
  derivation: { calls: number };
  spec: CharacterSheetSpec;
}> {
  const port = new FakeRulebookFieldDerivationPort();
  port.script(
    input.derivation === undefined
      ? []
      : [JSON.stringify({ schemaVersion: 1, fields: input.derivation })],
  );
  const outcome = await generateNormalizedSheet(
    {
      request: input.request,
      context: input.context ?? null,
      ...(input.instructions !== undefined
        ? { instructions: input.instructions }
        : {}),
    },
    { derivationPort: port } satisfies UnifiedGenerationDeps,
  );
  expect(outcome.kind).toBe("ok");
  if (outcome.kind !== "ok") {
    throw new Error("pipeline did not produce a definition");
  }
  const spec = await generateCharacterSheetSpec({
    definition: outcome.result.definition,
    context: input.context ?? baseContext,
    namePort: input.namePort ?? new BenchmarkNamePort(),
    ...(input.calculations !== undefined
      ? { calculations: input.calculations }
      : {}),
    ...(input.outputLocale !== undefined
      ? { outputLocale: input.outputLocale }
      : {}),
    ...(input.presentation !== undefined
      ? { presentation: input.presentation }
      : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });
  return {
    definition: outcome.result.definition,
    result: outcome.result,
    derivation: { calls: outcome.derivation.calls },
    spec,
  };
}

async function runSpec(
  input: {
    context?: RulesContext | null;
    calculations?: readonly CalculationCandidate[];
    outputLocale?: string;
    presentation?: GenerateCharacterSheetSpecInput["presentation"];
    namePort?: BenchmarkNamePort;
  },
  definition: NormalizedSheetDefinition,
): Promise<CharacterSheetSpec> {
  return generateCharacterSheetSpec({
    definition,
    context: input.context ?? baseContext,
    namePort: input.namePort ?? new BenchmarkNamePort(),
    ...(input.calculations !== undefined
      ? { calculations: input.calculations }
      : {}),
    ...(input.outputLocale !== undefined
      ? { outputLocale: input.outputLocale }
      : {}),
    ...(input.presentation !== undefined
      ? { presentation: input.presentation }
      : {}),
  });
}

async function failureOf(
  promise: Promise<unknown>,
): Promise<FinalConstructionFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FinalConstructionError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("Expected a FinalConstructionError.");
}

function fieldById(spec: CharacterSheetSpec, id: string) {
  return spec.fields.find((field) => field.id === id);
}

function addChain(depth: number, fieldKey: string): { [key: string]: unknown } {
  let expr: unknown = {
    op: "add",
    left: { op: "field", fieldKey },
    right: { op: "literal", value: 1 },
  };
  for (let i = 1; i < depth; i += 1) {
    expr = { op: "add", left: expr, right: { op: "literal", value: 1 } };
  }
  return expr as { [key: string]: unknown };
}

function pcRequest(
  overrides: Partial<{
    characterName: string | null;
    mechanicalFields: Array<{ label: string; initialValue: number | null }>;
    identityTraits: Array<{ label: string; value: string }>;
    outputLocale: string;
    contextInstructions: string;
  }> = {},
): CharacterSheetGenerationRequest {
  return {
    mode: "pc",
    ...(overrides.characterName !== undefined
      ? { characterName: overrides.characterName }
      : {}),
    mechanicalFields: overrides.mechanicalFields ?? [],
    identityTraits: overrides.identityTraits ?? [],
    ...(overrides.outputLocale !== undefined
      ? { outputLocale: overrides.outputLocale }
      : {}),
    ...(overrides.contextInstructions !== undefined
      ? { contextInstructions: overrides.contextInstructions }
      : {}),
  };
}

function npcRequest(overrides: {
  characterName?: string;
  threat: "weak" | "ordinary" | "dangerous" | "elite" | "boss";
  mechanicalFields: Array<{ label: string; min: number; max: number }>;
}): CharacterSheetGenerationRequest {
  return {
    mode: "npc",
    ...(overrides.characterName !== undefined
      ? { characterName: overrides.characterName }
      : {}),
    mechanicalFields: overrides.mechanicalFields,
    identityTraits: [],
    disposition: "enemy",
    threat: overrides.threat,
  };
}

describe("Phase 14.5 domain benchmark", () => {
  describe("A — GUI-only PC stays fully deterministic with zero providers", () => {
    it("resolves values, grouping and provenance without any AI call", async () => {
      const { definition, derivation, spec } = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria Stone",
          mechanicalFields: [
            { label: "Strength", initialValue: 8 },
            { label: "Dexterity", initialValue: 6 },
          ],
          identityTraits: [{ label: "Homeland", value: "Baytown" }],
        }),
      });
      expect(derivation.calls).toBe(0);
      expect(definition.conflicts).toHaveLength(0);
      expect(spec.mode).toBe("player");
      expect(spec.metadata.title).toBe("Character Sheet");
      expect(spec.metadata.id).toBe(baseContext.analysisId);
      expect(spec.metadata.locale).toBeNull();
      expect(spec.values[CHARACTER_NAME_KEY]).toBe("Aria Stone");
      expect(spec.values.strength).toBe(8);
      expect(spec.values.dexterity).toBe(6);
      expect(spec.values.homeland).toBe("Baytown");
      expect(spec.sections.map((section) => section.title)).toEqual([
        "Identity",
        "Attributes",
      ]);
      expect(Object.keys(spec.sourceMap)).toHaveLength(0);
      expect(validateCharacterSheetSpecDomain(spec, baseContext).valid).toBe(
        true,
      );
    });
  });

  describe("B — GUI-only NPC resolves threat-biased seeded values", () => {
    it("derives an in-range NPC value without any provider call", async () => {
      const { derivation, spec } = await runPipeline({
        context: null,
        request: npcRequest({
          characterName: "Sera",
          threat: "dangerous",
          mechanicalFields: [{ label: "Toughness", min: 10, max: 20 }],
        }),
        seed: "benchmark-seed-b",
      });
      expect(derivation.calls).toBe(0);
      expect(spec.mode).toBe("npc");
      expect(spec.metadata.title).toBe("NPC Sheet");
      const toughness = Number(spec.values.toughness);
      expect(typeof toughness).toBe("number");
      expect(toughness).toBeGreaterThanOrEqual(10);
      expect(toughness).toBeLessThanOrEqual(20);
      expect(validateCharacterSheetSpecDomain(spec, baseContext).valid).toBe(
        true,
      );

      const repeated = await runPipeline({
        context: null,
        request: npcRequest({
          characterName: "Sera",
          threat: "dangerous",
          mechanicalFields: [{ label: "Toughness", min: 10, max: 20 }],
        }),
        seed: "benchmark-seed-b",
      });
      expect(Number(repeated.spec.values.toughness)).toBe(toughness);
    });
  });

  describe("C — rulebook-only PC derives fields and compiles genuine evidence", () => {
    it("runs one derivation call and compiles rule provenance into the source map", async () => {
      const { derivation, spec } = await runPipeline({
        context: baseContext,
        request: pcRequest({ characterName: "Aria Stone" }),
        derivation: [
          {
            label: "Attack",
            category: "mechanical",
            explicitValue: 14,
            permittedValueRange: { min: 1, max: 20 },
            evidence: { ruleIds: [RULE_ATTACK_ID] },
          },
          {
            label: "Hit Points",
            category: "mechanical",
            explicitValue: 10,
            evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
          },
        ],
      });
      expect(derivation.calls).toBe(1);
      expect(spec.values.attack).toBe(14);
      expect(spec.values.hit_points).toBe(10);
      expect(spec.sourceMap.attack?.ruleIds).toEqual([RULE_ATTACK_ID]);
      expect(spec.sourceMap.hit_points?.ruleIds).toEqual([RULE_HIT_POINTS_ID]);
      expect(spec.sourceMap.attack?.citations).toHaveLength(1);
      expect(validateCharacterSheetSpecDomain(spec, baseContext).valid).toBe(
        true,
      );
    });

    it("rejects fabricated rule evidence as a visible conflict", async () => {
      const { definition } = await runPipeline({
        context: baseContext,
        request: pcRequest({ characterName: "Aria Stone" }),
        derivation: [
          {
            label: "Intelligence",
            category: "mechanical",
            explicitValue: 12,
            evidence: { ruleIds: ["rule-does-not-exist" as const] },
          },
        ],
      });
      expect(
        definition.conflicts.some(
          (conflict) => conflict.code === "FABRICATED_RULE_EVIDENCE",
        ),
      ).toBe(true);
    });
  });

  describe("D — rulebook-only NPC resolves values inside derived ranges", () => {
    it("combines derivation evidence with threat-biased seeded value resolution", async () => {
      const { derivation, definition, spec } = await runPipeline({
        context: baseContext,
        request: npcRequest({
          characterName: "Mara",
          threat: "elite",
          mechanicalFields: [],
        }),
        derivation: [
          {
            label: "Attack",
            category: "mechanical",
            permittedValueRange: { min: 1, max: 20 },
            evidence: { ruleIds: [RULE_ATTACK_ID] },
          },
        ],
        seed: "benchmark-seed-d",
      });
      expect(derivation.calls).toBe(1);
      expect(definition.npc?.threat).toBe("elite");
      expect(spec.sourceMap.attack?.ruleIds).toEqual([RULE_ATTACK_ID]);
      const attack = Number(spec.values.attack);
      expect(attack).toBeGreaterThanOrEqual(1);
      expect(attack).toBeLessThanOrEqual(20);
      expect(validateCharacterSheetSpecDomain(spec, baseContext).valid).toBe(
        true,
      );
    });
  });

  describe("E — combined sources apply Level-1 REMOVE on top", () => {
    it("keeps GUI and rulebook fields while a remove instruction deletes one field", async () => {
      const { result, spec } = await runPipeline({
        context: baseContext,
        request: pcRequest({
          characterName: "Tova",
          mechanicalFields: [
            { label: "Strength", initialValue: 8 },
            { label: "Dexterity", initialValue: 6 },
          ],
        }),
        derivation: [
          {
            label: "Attack",
            category: "mechanical",
            explicitValue: 15,
            permittedValueRange: { min: 1, max: 20 },
            evidence: { ruleIds: [RULE_ATTACK_ID] },
          },
        ],
        instructions: [
          { op: "field", override: { op: "remove", targetLabel: "Dexterity" } },
        ],
      });
      expect(result.instructionResult.appliedInstructions).toHaveLength(1);
      const fieldIds = spec.fields.map((field) => field.id);
      expect(fieldIds).toContain("strength");
      expect(fieldIds).toContain("attack");
      expect(fieldIds).not.toContain("dexterity");
      expect(spec.sourceMap.attack?.ruleIds).toEqual([RULE_ATTACK_ID]);
    });
  });

  describe("F — combined sources apply Level-1 REPLACE with key remap audit", () => {
    it("renames the rulebook field and records the canonical-key remap", async () => {
      const { result, spec } = await runPipeline({
        context: baseContext,
        request: pcRequest({
          characterName: "Tova",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
        derivation: [
          {
            label: "Attack",
            category: "mechanical",
            explicitValue: 15,
            permittedValueRange: { min: 1, max: 20 },
            evidence: { ruleIds: [RULE_ATTACK_ID] },
          },
        ],
        instructions: [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Attack",
              replacementLabel: "Weapon Skill",
            },
          },
        ],
      });
      expect(result.instructionResult.keyRemaps).toEqual([
        {
          category: "mechanical",
          fromKey: "attack",
          toKey: "weapon_skill",
          sourceLabel: "Attack",
          replacementLabel: "Weapon Skill",
        },
      ]);
      const fieldIds = spec.fields.map((field) => field.id);
      expect(fieldIds).not.toContain("attack");
      expect(fieldIds).toContain("weapon_skill");
      expect(spec.sourceMap.weapon_skill?.ruleIds).toEqual([RULE_ATTACK_ID]);
    });
  });

  describe("G — equal-authority disagreement surfaces visibly", () => {
    it("keeps the first source and reports EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT", async () => {
      const { definition, spec } = await runPipeline({
        context: baseContext,
        request: pcRequest({
          characterName: "Tova",
          mechanicalFields: [{ label: "Attack", initialValue: 14 }],
        }),
        derivation: [
          {
            label: "Attack",
            category: "mechanical",
            explicitValue: 12,
            evidence: { ruleIds: [RULE_ATTACK_ID] },
          },
        ],
      });
      const conflict = definition.conflicts.find(
        (entry) =>
          entry.code === "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT" &&
          entry.canonicalKey === "attack",
      );
      expect(conflict).toBeDefined();
      expect(spec.values.attack).toBe(14);
    });
  });

  describe("H — character-name authority and the definition boundary", () => {
    it("lets a Level-1 SET_CHARACTER_NAME override the GUI name", async () => {
      const { definition, result, spec } = await runPipeline({
        context: null,
        request: pcRequest({ characterName: "Aria Stone" }),
        instructions: [{ op: "set_character_name", value: "Drakon" }],
      });
      expect(definition.characterName).toBe("Drakon");
      expect(result.instructionResult.appliedInstructions).toEqual([
        { op: "set_character_name", characterName: "Drakon" },
      ]);
      expect(spec.values[CHARACTER_NAME_KEY]).toBe("Drakon");
    });

    it("fails visibly when the definition name and the character_name field disagree", async () => {
      const definition = NormalizedSheetDefinitionSchema.parse({
        schemaVersion: 1,
        mode: "pc",
        characterName: "B",
        fields: [
          {
            canonicalKey: "character_name",
            label: "Character Name",
            category: "identity",
            explicitValue: "A",
            provenance: { origins: ["gui"] },
          },
        ],
        overrides: [],
        conflicts: [],
      });
      const reason = await failureOf(
        generateCharacterSheetSpec({
          definition,
          context: baseContext,
          namePort: new BenchmarkNamePort(),
        }),
      );
      expect(reason).toBe("conflicting_character_name");
    });

    it("never uses the character name as the sheet title", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({ characterName: "Aria Stone" }),
      });
      expect(spec.metadata.title).toBe("Character Sheet");
      expect(spec.metadata.title).not.toBe("Aria Stone");
    });
  });

  describe("I — blank PC name reaches only the Level-3 name port", () => {
    it("mints a name through exactly one name-port call", async () => {
      const port = new BenchmarkNamePort().scriptWith(["Kavu the Brave"]);
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({ mechanicalFields: [] }),
        namePort: port,
      });
      expect(port.calls).toBe(1);
      expect(spec.values[CHARACTER_NAME_KEY]).toBe("Kavu the Brave");
    });

    it("fails visibly when the name provider is unavailable", async () => {
      const port = new BenchmarkNamePort().scriptWith(["THROW"]);
      const reason = await failureOf(
        runSpec({ namePort: port }, makeBlankPcDefinition()),
      );
      expect(reason).toBe("name_provider_unavailable");
    });
  });

  describe("J — NPC threat bias is deterministic, in-range and seed-varying", () => {
    const threats = ["weak", "ordinary", "dangerous", "elite", "boss"] as const;

    it("resolves in-range values with zero provider calls and never escapes the bounds", async () => {
      let toughnessFieldBounds: { min: number; max: number } | null = null;
      for (const threat of threats) {
        const { derivation, spec } = await runPipeline({
          context: null,
          request: npcRequest({
            characterName: "Vex",
            threat,
            mechanicalFields: [{ label: "Toughness", min: 10, max: 20 }],
          }),
          seed: `benchmark-j-${threat}`,
        });
        expect(derivation.calls).toBe(0);
        const value = spec.values.toughness;
        expect(typeof value).toBe("number");
        expect(value as number).toBeGreaterThanOrEqual(10);
        expect(value as number).toBeLessThanOrEqual(20);
        const field = fieldById(spec, "toughness");
        if (field?.type === "number") {
          toughnessFieldBounds = { min: field.min ?? 10, max: field.max ?? 20 };
        }
      }
      expect(toughnessFieldBounds).toEqual({ min: 10, max: 20 });
    });

    it("same seed reproduces the same value for every tier", async () => {
      for (const threat of threats) {
        const params = (threatValue: typeof threat) => ({
          context: null,
          request: npcRequest({
            characterName: "Vex",
            threat: threatValue,
            mechanicalFields: [{ label: "Toughness", min: 10, max: 20 }],
          }),
          seed: "benchmark-j-repro",
        });
        const first = await runPipeline(params(threat));
        const second = await runPipeline(params(threat));
        expect(second.spec.values.toughness).toBe(first.spec.values.toughness);
      }
    });

    it("boss retains variation across seeds and does not always return the max", async () => {
      const seen = new Set<number>();
      for (let index = 0; index < 40; index += 1) {
        const { spec } = await runPipeline({
          context: null,
          request: npcRequest({
            characterName: "Vex",
            threat: "boss",
            mechanicalFields: [{ label: "Toughness", min: 10, max: 20 }],
          }),
          seed: `benchmark-boss-${index}`,
        });
        const value = Number(spec.values.toughness);
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThanOrEqual(20);
        seen.add(value);
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it("keeps a fixed min==max value under any threat", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: npcRequest({
          characterName: "Vex",
          threat: "boss",
          mechanicalFields: [{ label: "Level", min: 5, max: 5 }],
        }),
      });
      expect(spec.values.level).toBe(5);
    });
  });

  describe("K — calculations stay bounded and formula-invalid inputs fail", () => {
    it("compiles a valid symbolic formula target and omits a direct value", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Kara",
          mechanicalFields: [
            { label: "Strength", initialValue: 8 },
            { label: "Dexterity", initialValue: 6 },
            { label: "Initiative", initialValue: null },
          ],
        }),
        calculations: [
          {
            key: "initiative",
            label: "Initiative",
            ruleIds: [],
            expression: {
              op: "add",
              left: { op: "field", fieldKey: "strength" },
              right: { op: "field", fieldKey: "dexterity" },
            },
          },
        ],
      });
      const initiative = fieldById(spec, "initiative");
      expect(initiative?.type).toBe("calculated");
      if (initiative?.type !== "calculated") return;
      expect(initiative.formula).toEqual({
        op: "add",
        left: { op: "field", fieldId: "strength" },
        right: { op: "field", fieldId: "dexterity" },
      });
      expect(spec.values).not.toHaveProperty("initiative");
      expect(spec.values.strength).toBe(8);
      expect(spec.values.dexterity).toBe(6);
      expect(validateCharacterSheetSpecDomain(spec, baseContext).valid).toBe(
        true,
      );
    });

    it("rejects a formula referencing an unknown field as compile_failed", async () => {
      const reason = await failureOf(
        runPipeline({
          context: null,
          request: pcRequest({
            characterName: "Kara",
            mechanicalFields: [
              { label: "Strength", initialValue: 8 },
              { label: "Initiative", initialValue: null },
            ],
          }),
          calculations: [
            {
              key: "initiative",
              label: "Initiative",
              ruleIds: [],
              expression: { op: "field", fieldKey: "wizard_level" },
            },
          ],
        }).then((output) => output.spec),
      );
      expect(reason).toBe("compile_failed");
    });

    it("rejects a formula cycle at compile time as compile_failed", async () => {
      const reason = await failureOf(
        runPipeline({
          context: null,
          request: pcRequest({
            characterName: "Kara",
            mechanicalFields: [
              { label: "Alpha", initialValue: null },
              { label: "Beta", initialValue: null },
            ],
          }),
          calculations: [
            {
              key: "alpha",
              label: "Alpha",
              ruleIds: [],
              expression: { op: "field", fieldKey: "beta" },
            },
            {
              key: "beta",
              label: "Beta",
              ruleIds: [],
              expression: { op: "field", fieldKey: "alpha" },
            },
          ],
        }).then((output) => output.spec),
      );
      expect(reason).toBe("compile_failed");
    });

    it("rejects an expression deeper than MAX_CALC_AST_DEPTH as invalid_calculation", async () => {
      const reason = await failureOf(
        runPipeline({
          context: null,
          request: pcRequest({
            characterName: "Kara",
            mechanicalFields: [{ label: "Deep", initialValue: null }],
          }),
          calculations: [
            {
              key: "deep",
              label: "Deep",
              ruleIds: [],
              expression: addChain(
                7,
                "deep",
              ) as CalculationCandidate["expression"],
            },
          ],
        }).then((output) => output.spec),
      );
      expect(reason).toBe("invalid_calculation");
    });

    it("rejects a calculated target that carries an explicit value", async () => {
      const reason = await failureOf(
        runPipeline({
          context: null,
          request: pcRequest({
            characterName: "Kara",
            mechanicalFields: [{ label: "Fortitude", initialValue: 5 }],
          }),
          calculations: [
            {
              key: "fortitude",
              label: "Fortitude",
              ruleIds: [],
              expression: { op: "literal", value: 1 },
            },
          ],
        }).then((output) => output.spec),
      );
      expect(reason).toBe("calculated_value_conflict");
    });
  });

  describe("L — localization is carried through deterministically", () => {
    it("applies Spanish section titles and metadata locale", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          outputLocale: "es",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
        outputLocale: "es",
      });
      expect(spec.metadata.locale).toBe("es");
      expect(spec.sections.map((section) => section.title)).toEqual([
        "Identidad",
        "Atributos",
      ]);
    });

    it("defaults to English titles and a null locale", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
      });
      expect(spec.metadata.locale).toBeNull();
      expect(spec.sections.map((section) => section.title)).toEqual([
        "Identity",
        "Attributes",
      ]);
    });
  });

  describe("M — presentation input never leaks into the compiled mechanics", () => {
    it("compiles identical specs for different presentation inputs", async () => {
      const bare = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
      });
      const ornate = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
        presentation: {
          visualStyle: "ornate",
          history: "Grew up near the docks.",
          portrait: { kind: "url", url: "https://example.com/aria.png" },
        },
      });
      expect(ornate.spec).toEqual(bare.spec);
      expect(ornate.spec.theme.style).toBe(bare.spec.theme.style);
    });

    it("leaves metadata.description null under presentation input", async () => {
      const { spec } = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
        presentation: {
          history: "A long backstory list.",
          visualStyle: "modern",
        },
      });
      expect(spec.metadata.description).toBeNull();
      expect(spec.fields.some((field) => field.type === "image")).toBe(false);
    });
  });

  describe("N — deferred free-text contextInstructions stay inert", () => {
    it("changes nothing in the deterministic definition", async () => {
      const baseline = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
        }),
      });
      const withInstructions = await runPipeline({
        context: null,
        request: pcRequest({
          characterName: "Aria",
          mechanicalFields: [{ label: "Strength", initialValue: 8 }],
          contextInstructions: "Make weapons more dangerous.",
        }),
      });
      expect(withInstructions.definition).toEqual(baseline.definition);
      expect(withInstructions.spec).toEqual(baseline.spec);
    });
  });
});

function makeBlankPcDefinition(): NormalizedSheetDefinition {
  return NormalizedSheetDefinitionSchema.parse({
    schemaVersion: 1,
    mode: "pc",
    characterName: null,
    fields: [],
    overrides: [],
    conflicts: [],
  });
}
