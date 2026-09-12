import { describe, expect, it } from "vitest";
import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import type { CalculationCandidate } from "./intermediate.js";
import {
  NormalizedSheetDefinitionSchema,
  type NormalizedSheetDefinition,
  type SourceResolvedField,
} from "./source-resolution.js";
import type { Level3NamePort } from "./ports.js";
import { RULE_ATTACK_ID, makeRulesContext } from "./test/fakes.js";
import {
  CHARACTER_NAME_KEY,
  FinalConstructionError,
  generateCharacterSheetSpec,
  type FinalConstructionFailure,
  type GenerateCharacterSheetSpecInput,
} from "./final-construction.js";
import * as finalConstruction from "./final-construction.js";

const context = makeRulesContext();

let nameSeed = 0;
function nextName(): string {
  nameSeed += 1;
  return `Generated Hero ${nameSeed}`;
}

class FakeNamePort implements Level3NamePort {
  calls = 0;
  script: Array<string | "THROW"> = [];

  scriptWith(next: readonly (string | "THROW")[]) {
    this.script = [...next];
    return this;
  }

  fallback(): FakeNamePort {
    this.script = [];
    return this;
  }

  async generateName(): Promise<string> {
    this.calls += 1;
    const next = this.script.shift();
    if (next === undefined) {
      return nextName();
    }
    if (next === "THROW") {
      throw new Error("name provider down");
    }
    return next;
  }
}

function identityField(
  key: string,
  label: string,
  options: { value?: string; origin?: string } = {},
): SourceResolvedField {
  return {
    canonicalKey: key,
    label,
    category: "identity",
    explicitValue: options.value ?? null,
    provenance: { origins: [options.origin ?? "gui"] },
  } as SourceResolvedField;
}

function mechanicalField(
  key: string,
  label: string,
  options: {
    value?: number;
    range?: [number, number];
    ruleIds?: string[];
  } = {},
): SourceResolvedField {
  return {
    canonicalKey: key,
    label,
    category: "mechanical",
    explicitValue: options.value ?? null,
    permittedValueRange:
      options.range === undefined
        ? undefined
        : { min: options.range[0], max: options.range[1] },
    provenance: {
      origins:
        options.ruleIds === undefined
          ? (["gui"] as const)
          : (["rulebook"] as const),
      ...(options.ruleIds === undefined ? {} : { ruleIds: options.ruleIds }),
    },
  } as SourceResolvedField;
}

function makeDefinition(
  overrides: Record<string, unknown> = {},
): NormalizedSheetDefinition {
  return NormalizedSheetDefinitionSchema.parse({
    schemaVersion: 1,
    mode: "pc",
    characterName: null,
    fields: [],
    overrides: [],
    conflicts: [],
    ...overrides,
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

function baseInput(
  namePort: FakeNamePort,
  overrides: Partial<GenerateCharacterSheetSpecInput> = {},
): GenerateCharacterSheetSpecInput {
  return {
    definition: makeDefinition(),
    context,
    namePort,
    ...overrides,
  };
}

function nameField(value: string): SourceResolvedField {
  return identityField(CHARACTER_NAME_KEY, "Character Name", { value });
}

async function run(
  namePort: FakeNamePort,
  overrides: Partial<GenerateCharacterSheetSpecInput> = {},
): Promise<CharacterSheetSpec> {
  return generateCharacterSheetSpec(baseInput(namePort, overrides));
}

describe("generateCharacterSheetSpec — name resolution", () => {
  it("preserves a supplied character name with zero name-provider calls", async () => {
    const port = new FakeNamePort().fallback();
    const spec = await run(port, {
      definition: makeDefinition({ characterName: "Aria Stone" }),
    });
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Aria Stone");
    expect(port.calls).toBe(0);
    expect(spec.metadata.title).toBe("Character Sheet");
    expect(spec.metadata.title).not.toBe("Aria Stone");
  });

  it("preserves a supplied NPC character name", async () => {
    const port = new FakeNamePort().fallback();
    const spec = await run(port, {
      definition: makeDefinition({
        mode: "npc",
        characterName: "Baron Grim",
        npc: { disposition: "enemy", threat: "boss" },
      }),
    });
    expect(spec.mode).toBe("npc");
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Baron Grim");
    expect(port.calls).toBe(0);
    expect(spec.metadata.title).toBe("NPC Sheet");
  });

  it("generates a name when no name and no character_name field exist", async () => {
    const port = new FakeNamePort().scriptWith(["March Hare"]);
    const spec = await run(port);
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("March Hare");
    expect(port.calls).toBe(1);
  });

  it("reuses an existing character_name field value with zero provider calls", async () => {
    const port = new FakeNamePort().fallback();
    const spec = await run(port, {
      definition: makeDefinition({ fields: [nameField("Kestrel")] }),
    });
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Kestrel");
    expect(port.calls).toBe(0);
  });

  it("prefers a supplied name over a matching existing field", async () => {
    const port = new FakeNamePort().fallback();
    const spec = await run(port, {
      definition: makeDefinition({
        characterName: "Kestrel",
        fields: [nameField("Kestrel")],
      }),
    });
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Kestrel");
    expect(port.calls).toBe(0);
  });

  it("fails visibly on a supplied name conflicting with the field", async () => {
    const port = new FakeNamePort().fallback();
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          characterName: "Kestrel",
          fields: [nameField("Crow")],
        }),
      }),
    );
    expect(reason).toBe("conflicting_character_name");
    expect(port.calls).toBe(0);
  });

  it("fails visibly on duplicate character_name fields", async () => {
    const port = new FakeNamePort().fallback();
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [nameField("Kestrel"), nameField("Crow")],
        }),
      }),
    );
    expect(reason).toBe("duplicate_character_name");
    expect(port.calls).toBe(0);
  });

  it("fails visibly on a blank Level-3 result after bounded retries", async () => {
    const port = new FakeNamePort().scriptWith(["", "   "]);
    const reason = await failureOf(run(port));
    expect(reason).toBe("invalid_character_name");
    expect(port.calls).toBe(2);
  });

  it("retries a blank result and accepts the next valid name", async () => {
    const port = new FakeNamePort().scriptWith(["   ", "Ember"]);
    const spec = await run(port);
    expect(spec.values[CHARACTER_NAME_KEY]).toBe("Ember");
    expect(port.calls).toBe(2);
  });

  it("fails visibly when the name provider is unavailable", async () => {
    const port = new FakeNamePort().scriptWith(["THROW"]);
    const reason = await failureOf(run(port));
    expect(reason).toBe("name_provider_unavailable");
  });

  it("fails visibly when the provider only returns over-long names", async () => {
    const port = new FakeNamePort().scriptWith([
      "X".repeat(300),
      "Y".repeat(300),
    ]);
    const reason = await failureOf(run(port));
    expect(reason).toBe("invalid_character_name");
    expect(port.calls).toBe(2);
  });

  it("fails visibly on an over-long existing field name", async () => {
    const port = new FakeNamePort().fallback();
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({ fields: [nameField("X".repeat(300))] }),
      }),
    );
    expect(reason).toBe("invalid_character_name");
    expect(port.calls).toBe(0);
  });

  it("always exposes exactly one canonical character_name", async () => {
    const port = new FakeNamePort().scriptWith(["Rook"]);
    const spec = await run(port);
    expect(
      spec.fields.filter((field) => field.id === CHARACTER_NAME_KEY),
    ).toHaveLength(1);
    expect(Object.keys(spec.values)).toContain(CHARACTER_NAME_KEY);
    expect(
      Object.keys(spec.values).filter((key) => key === CHARACTER_NAME_KEY),
    ).toHaveLength(1);
  });
});

describe("generateCharacterSheetSpec — PC values", () => {
  it("plans no AI and leaves an explicit PC value on the sheet", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        fields: [mechanicalField("strength", "Strength", { value: 14 })],
      }),
    });
    expect(spec.values.strength).toBe(14);
  });

  it("leaves a blank PC value blank (no invented value)", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        fields: [mechanicalField("strength", "Strength")],
      }),
    });
    expect(Object.hasOwn(spec.values, "strength")).toBe(false);
  });

  it("fails visibly on a PC explicit value outside its permitted range", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [
            mechanicalField("strength", "Strength", {
              value: 25,
              range: [1, 20],
            }),
          ],
        }),
      }),
    );
    expect(reason).toBe("invalid_mechanical_value");
  });

  it("fails visibly on a non-numeric explicit mechanical value", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [
            {
              canonicalKey: "strength",
              label: "Strength",
              category: "mechanical",
              explicitValue: "high",
              provenance: { origins: ["context-override" as const] },
            } as SourceResolvedField,
          ],
        }),
      }),
    );
    expect(reason).toBe("invalid_mechanical_value");
  });
});

describe("generateCharacterSheetSpec — NPC values", () => {
  function npcInput(
    field: SourceResolvedField,
    threat: "weak" | "ordinary" | "dangerous" | "elite" | "boss" | null,
  ): GenerateCharacterSheetSpecInput {
    return baseInput(new FakeNamePort().scriptWith(["Grim"]), {
      definition: makeDefinition({
        mode: "npc",
        npc: {
          disposition: threat === null ? "ally" : "enemy",
          threat,
        },
        fields: [field],
      }),
    });
  }

  it("preserves an explicit NPC value", async () => {
    const spec = await generateCharacterSheetSpec(
      npcInput(mechanicalField("armor", "Armor", { value: 12 }), "ordinary"),
    );
    expect(spec.values.armor).toBe(12);
  });

  it("resolves a fixed range deterministically for any threat", async () => {
    const spec = await generateCharacterSheetSpec(
      npcInput(
        mechanicalField("hp_pool", "Hit Points", { range: [40, 40] }),
        "boss",
      ),
    );
    expect(spec.values.hp_pool).toBe(40);
  });

  it("resolves a bounded range to its midpoint without a threat", async () => {
    const spec = await generateCharacterSheetSpec(
      npcInput(
        mechanicalField("hp_pool", "Hit Points", { range: [10, 20] }),
        null,
      ),
    );
    expect(spec.values.hp_pool).toBe(15);
  });

  it("bias never escapes the permitted range for any threat", async () => {
    const cases: Array<{
      threat: "weak" | "ordinary" | "dangerous" | "elite" | "boss";
      expected: number;
    }> = [
      { threat: "weak", expected: 12.5 },
      { threat: "ordinary", expected: 15 },
      { threat: "dangerous", expected: 17.5 },
      { threat: "elite", expected: 19 },
      { threat: "boss", expected: 20 },
    ];
    for (const entry of cases) {
      const spec = await generateCharacterSheetSpec(
        baseInput(new FakeNamePort().scriptWith(["Grim"]), {
          definition: makeDefinition({
            mode: "npc",
            npc: { disposition: "enemy", threat: entry.threat },
            fields: [
              mechanicalField("hp_pool", "Hit Points", { range: [10, 20] }),
            ],
          }),
        }),
      );
      expect(spec.values.hp_pool).toBe(entry.expected);
    }
  });

  it("leaves an unbounded NPC range blank", async () => {
    const spec = await generateCharacterSheetSpec(
      npcInput(mechanicalField("rerolls", "Rerolls"), "boss"),
    );
    expect(Object.hasOwn(spec.values, "rerolls")).toBe(false);
  });

  it("threat never modifies the permitted range", async () => {
    const spec = await generateCharacterSheetSpec(
      npcInput(
        mechanicalField("hp_pool", "Hit Points", { range: [10, 20] }),
        "weak",
      ),
    );
    const field = spec.fields.find((entry) => entry.id === "hp_pool");
    expect(field).toMatchObject({ min: 10, max: 20 });
    expect(spec.values.hp_pool).toBe(12.5);
  });
});

describe("generateCharacterSheetSpec — formulas", () => {
  function calculation(
    key: string,
    expression: CalculationCandidate["expression"],
  ): CalculationCandidate {
    return { key, label: key, ruleIds: [], expression };
  }

  const add = (
    left: CalculationCandidate["expression"],
    right: CalculationCandidate["expression"],
  ): CalculationCandidate["expression"] => ({
    op: "add",
    left,
    right,
  });

  it("accepts zero formulas", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        fields: [mechanicalField("strength", "Strength", { value: 10 })],
      }),
    });
    expect(
      spec.fields.filter((field) => field.type === "calculated"),
    ).toHaveLength(0);
  });

  it("promotes a matching mechanical field to calculated with a compiled formula", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        fields: [
          mechanicalField("strength", "Strength", { value: 12 }),
          mechanicalField("damage", "Damage"),
        ],
      }),
      calculations: [
        calculation(
          "damage",
          add(
            { op: "field", fieldKey: "strength" },
            { op: "literal", value: 2 },
          ),
        ),
      ],
    });
    const damage = spec.fields.find((field) => field.id === "damage");
    expect(damage?.type).toBe("calculated");
    expect(damage).toMatchObject({ formula: { op: "add" } });
    expect(Object.hasOwn(spec.values, "damage")).toBe(false);
  });

  it("rejects a calculation target that is not a definition field", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [mechanicalField("strength", "Strength", { value: 12 })],
        }),
        calculations: [
          calculation(
            "ghost",
            add({ op: "literal", value: 1 }, { op: "literal", value: 2 }),
          ),
        ],
      }),
    );
    expect(reason).toBe("unknown_calculation_field");
  });

  it("rejects a calculation targeting an identity field", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [identityField("species", "Species", { value: "Human" })],
        }),
        calculations: [
          calculation(
            "species",
            add({ op: "literal", value: 1 }, { op: "literal", value: 2 }),
          ),
        ],
      }),
    );
    expect(reason).toBe("invalid_calculation_target");
  });

  it("rejects a calculation on a field that already carries an explicit value", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [mechanicalField("damage", "Damage", { value: 8 })],
        }),
        calculations: [
          calculation(
            "damage",
            add({ op: "literal", value: 1 }, { op: "literal", value: 2 }),
          ),
        ],
      }),
    );
    expect(reason).toBe("calculated_value_conflict");
  });

  it("rejects an over-deep calculation expression", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    let expression: CalculationCandidate["expression"] = {
      op: "literal",
      value: 1,
    };
    for (let index = 0; index < 8; index += 1) {
      expression = add(expression, { op: "literal", value: 1 });
    }
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [mechanicalField("total", "Total")],
        }),
        calculations: [calculation("total", expression)],
      }),
    );
    expect(reason).toBe("invalid_calculation");
  });

  it("rejects duplicate calculation keys", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [mechanicalField("damage", "Damage")],
        }),
        calculations: [
          calculation(
            "damage",
            add({ op: "literal", value: 1 }, { op: "literal", value: 2 }),
          ),
          calculation(
            "damage",
            add({ op: "literal", value: 1 }, { op: "literal", value: 2 }),
          ),
        ],
      }),
    );
    expect(reason).toBe("invalid_calculation");
  });

  it("surfaces compile failures as compile_failed", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [mechanicalField("damage", "Damage")],
        }),
        calculations: [
          calculation(
            "damage",
            add(
              { op: "field", fieldKey: "missing" },
              { op: "literal", value: 1 },
            ),
          ),
        ],
      }),
    );
    expect(reason).toBe("compile_failed");
  });

  it("surfaces a formula cycle as compile_failed", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const reason = await failureOf(
      run(port, {
        definition: makeDefinition({
          fields: [
            mechanicalField("alpha", "Alpha"),
            mechanicalField("beta", "Beta"),
          ],
        }),
        calculations: [
          calculation(
            "alpha",
            add({ op: "field", fieldKey: "beta" }, { op: "literal", value: 1 }),
          ),
          calculation(
            "beta",
            add(
              { op: "field", fieldKey: "alpha" },
              { op: "literal", value: 1 },
            ),
          ),
        ],
      }),
    );
    expect(reason).toBe("compile_failed");
  });
});

describe("generateCharacterSheetSpec — grouping and metadata", () => {
  it("groups identity (with the name) before attributes and covers every field", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        characterName: "Aria",
        fields: [
          identityField("origin", "Origin", { value: "Vale" }),
          mechanicalField("strength", "Strength", { value: 10 }),
          mechanicalField("agility", "Agility", { value: 12 }),
        ],
      }),
    });
    expect(spec.sections.map((section) => section.id)).toEqual([
      "identity",
      "attributes",
    ]);
    expect(spec.sections[0]).toMatchObject({ title: "Identity" });
    expect(spec.sections[1]).toMatchObject({ title: "Attributes" });
    expect(spec.sections[0]!.fieldIds).toEqual([CHARACTER_NAME_KEY, "origin"]);
    expect(spec.sections[1]!.fieldIds).toEqual(["strength", "agility"]);
    expect(spec.fields.length).toBe(4);
  });

  it("uses Spanish Identidad/Atributos for an es locale", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      outputLocale: "es",
      definition: makeDefinition({
        characterName: "Aria",
        fields: [mechanicalField("fuerza", "Fuerza", { value: 10 })],
      }),
    });
    expect(spec.sections[0]).toMatchObject({ title: "Identidad" });
    expect(spec.sections[1]).toMatchObject({ title: "Atributos" });
    expect(spec.metadata.locale).toBe("es");
  });

  it("applies an English locale to the metadata and keeps English titles", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      outputLocale: "en",
      definition: makeDefinition({ characterName: "Aria" }),
    });
    expect(spec.metadata.locale).toBe("en");
    expect(spec.sections[0]).toMatchObject({ title: "Identity" });
  });

  it("never uses the character name as the sheet title (PC and NPC)", async () => {
    const port = new FakeNamePort().scriptWith(["Grim"]);
    const pc = await run(port, {
      definition: makeDefinition({ characterName: "Aria" }),
    });
    const npc = await run(port, {
      definition: makeDefinition({
        mode: "npc",
        characterName: "Grim",
        npc: { disposition: "enemy", threat: "boss" },
      }),
    });
    expect(pc.metadata.title).toBe("Character Sheet");
    expect(npc.metadata.title).toBe("NPC Sheet");
  });

  it("exposes only definition-owned fields (no invented fields)", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        characterName: "Aria",
        fields: [mechanicalField("luck", "Luck", { value: 7 })],
      }),
    });
    expect(spec.fields.map((field) => field.id).sort()).toEqual(
      [CHARACTER_NAME_KEY, "luck"].sort(),
    );
  });
});

describe("generateCharacterSheetSpec — presentation isolation", () => {
  it("presentation input never alters mechanics or values", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const plain = await run(port, {
      definition: makeDefinition({
        characterName: "Aria",
        fields: [
          identityField("origin", "Origin", { value: "Vale" }),
          mechanicalField("strength", "Strength", { value: 10 }),
        ],
      }),
    });
    const styled = await run(port, {
      presentation: {
        visualStyle: "parchment",
        history: "A veteran ranger.",
        portrait: { kind: "url", url: "https://example.com/_x.png" },
      },
      definition: makeDefinition({
        characterName: "Aria",
        fields: [
          identityField("origin", "Origin", { value: "Vale" }),
          mechanicalField("strength", "Strength", { value: 10 }),
        ],
      }),
    });
    expect(styled).toEqual(plain);
  });
});

describe("generateCharacterSheetSpec — provenance and determinism", () => {
  it("carries rule evidence for rule-derived fields and none for traits", async () => {
    const port = new FakeNamePort().scriptWith(["Aria"]);
    const spec = await run(port, {
      definition: makeDefinition({
        characterName: "Aria",
        fields: [
          mechanicalField("attack", "Attack", {
            range: [0, 20],
            ruleIds: [RULE_ATTACK_ID],
          }),
          identityField("origin", "Origin", { value: "Vale" }),
        ],
      }),
    });
    const attack = spec.fields.find((field) => field.id === "attack");
    expect(spec.sourceMap.attack?.ruleIds).toEqual([RULE_ATTACK_ID]);
    expect(attack?.label).toBe("Attack");
    expect(Object.hasOwn(spec.sourceMap, "origin")).toBe(false);
    expect(Object.hasOwn(spec.sourceMap, CHARACTER_NAME_KEY)).toBe(false);
  });

  it("is deterministic for identical input and identical Level-3 result", async () => {
    const shared = makeDefinition({
      characterName: "Aria",
      fields: [
        mechanicalField("strength", "Strength", { value: 12, range: [1, 20] }),
      ],
    });
    const first = await generateCharacterSheetSpec({
      definition: shared,
      context,
      namePort: new FakeNamePort().fallback(),
    });
    const second = await generateCharacterSheetSpec({
      definition: shared,
      context,
      namePort: new FakeNamePort().fallback(),
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("rejects an invalid normalized definition", async () => {
    const port = new FakeNamePort().fallback();
    const reason = await failureOf(
      run(port, {
        definition: { schemaVersion: 2, mode: "pc", fields: [] } as never,
      }),
    );
    expect(reason).toBe("invalid_definition");
  });

  it("rejects an NPC definition without an npc block", async () => {
    const port = new FakeNamePort().fallback();
    const reason = await failureOf(
      run(port, {
        definition: {
          schemaVersion: 1,
          mode: "npc",
          characterName: "Grim",
          fields: [],
          overrides: [],
          conflicts: [],
        } as never,
      }),
    );
    expect(reason).toBe("invalid_definition");
  });
});

describe("drifted Level-3 vocabulary removal", () => {
  it("no longer exports the drifted construction vocab", () => {
    const exports_ = Object.keys(finalConstruction);
    expect(exports_).not.toContain("ModelSpecSchema");
    expect(exports_).not.toContain("SheetGroupingMode");
    expect(exports_).not.toContain("DATA_COLLECTION_ENTRIES");
    expect(exports_).not.toContain("TargetPagePlan");
    expect(exports_).not.toContain("requiredDataCollectionTarget");
    expect(exports_).not.toContain("buildSheetGroupingProposal");
    expect(exports_).toContain("generateCharacterSheetSpec");
    expect(exports_).toContain("FinalConstructionError");
    expect(exports_).toContain("CHARACTER_NAME_KEY");
  });

  // Compile-time guarantees that the drifted symbols are truly gone.
  // @ts-expect-error drifted ModelSpecSchema must not exist
  finalConstruction.ModelSpecSchema;
  // @ts-expect-error drifted data collection must not exist
  finalConstruction.DATA_COLLECTION_ENTRIES;
});
