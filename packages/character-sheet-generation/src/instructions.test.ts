import { describe, expect, it } from "vitest";
import {
  applyGenerationInstructions,
  GenerationInstructionApplicationResultSchema,
  KeyRemapSchema,
  NpcPortraitIntentSchema,
  ProposedGenerationInstructionSchema,
  RejectedGenerationInstructionSchema,
  ValidatedGenerationInstructionSchema,
} from "./instructions.js";
import { MAX_TOTAL_FIELDS } from "./model.js";
import {
  canonicalizeFieldLabel,
  GENERATION_CONFLICT_CODES,
  GenerationConflictSchema,
  MAX_EXPLICIT_INPUT_OVERRIDES,
  NormalizedSheetDefinitionSchema,
  type ExplicitSheetOverride,
  type GenerationConflict,
  type NormalizedSheetDefinition,
  type SourceResolvedField,
} from "./source-resolution.js";

const rulebookCitations = [
  {
    sourceId: "src-1",
    pageStart: 10,
    pageEnd: 12,
    section: "Chapter 3",
    chunkId: null,
  },
  {
    sourceId: "src-2",
    pageStart: 4,
    pageEnd: 4,
    section: "Intro",
    chunkId: "chunk-2",
  },
];

function guiMechanical(
  label: string,
  explicitValue?: number | null,
  range?: { min: number; max: number },
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    explicitValue: explicitValue ?? null,
    ...(range !== undefined ? { permittedValueRange: range } : {}),
    provenance: { origins: ["gui"] },
  };
}

function guiIdentity(
  label: string,
  value?: string | null,
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "identity",
    explicitValue: value ?? null,
    provenance: { origins: ["gui"] },
  };
}

function rulebookMechanical(
  label: string,
  options: {
    range?: { min: number; max: number };
    explicitValue?: number;
  } = {},
): SourceResolvedField {
  return {
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    ...(options.range !== undefined
      ? { permittedValueRange: options.range }
      : {}),
    ...(options.explicitValue !== undefined
      ? { explicitValue: options.explicitValue }
      : {}),
    provenance: {
      origins: ["rulebook"],
      ruleIds: ["rule-1", "rule-2"],
      citations: rulebookCitations,
    },
  };
}

function makeDefinition(
  fields: SourceResolvedField[],
  options: {
    mode?: "pc" | "npc";
    characterName?: string | null;
    conflicts?: GenerationConflict[];
    overrides?: ExplicitSheetOverride[];
  } = {},
): NormalizedSheetDefinition {
  return NormalizedSheetDefinitionSchema.parse({
    schemaVersion: 1,
    mode: options.mode ?? "pc",
    characterName: options.characterName ?? null,
    fields,
    overrides: options.overrides ?? [],
    conflicts: options.conflicts ?? [],
    ...(options.mode === "npc"
      ? { npc: { disposition: "enemy", threat: "boss" } }
      : {}),
  });
}

function conflictOf(
  code: GenerationConflict["code"],
  canonicalKey: string | null,
  sourceLabels: string[] = [],
): GenerationConflict {
  return GenerationConflictSchema.parse({
    code,
    canonicalKey,
    message: "Test conflict.",
    sourceLabels,
  });
}

const pcDefinition = makeDefinition([
  guiMechanical("Strength"),
  guiIdentity("Notes"),
]);
const mechanicalIdentityDefinition = makeDefinition([
  guiMechanical("Notes"),
  guiIdentity("Notes"),
]);

describe("ProposedGenerationInstructionSchema", () => {
  it("accepts field, name and portrait instruction shapes", () => {
    const valid = [
      {
        op: "field",
        override: { op: "add", label: "Honor", category: "mechanical" },
      },
      { op: "set_character_name", value: "  Gruk  " },
      {
        op: "request_npc_portrait",
        intent: {
          description: "A scarred veteran with a wolf-skin cloak.",
          requestedVia: "contextInstructions",
        },
      },
    ];
    for (const instruction of valid) {
      expect(
        ProposedGenerationInstructionSchema.safeParse(instruction).success,
      ).toBe(true);
    }
  });

  it("rejects unknown operations", () => {
    const result = ProposedGenerationInstructionSchema.safeParse({
      op: "destroy",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank character name", () => {
    const result = ProposedGenerationInstructionSchema.safeParse({
      op: "set_character_name",
      value: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trims a supplied character name", () => {
    const result = ProposedGenerationInstructionSchema.parse({
      op: "set_character_name",
      value: "  Gruk  ",
    });
    expect(result).toEqual({ op: "set_character_name", value: "Gruk" });
  });

  it("rejects a portrait intent without a prompt or description", () => {
    const result = ProposedGenerationInstructionSchema.safeParse({
      op: "request_npc_portrait",
      intent: { requestedVia: "contextInstructions" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects portrait intents not requested through context instructions", () => {
    const result = ProposedGenerationInstructionSchema.safeParse({
      op: "request_npc_portrait",
      intent: { prompt: "A portrait", requestedVia: "rulebook" },
    });
    expect(result.success).toBe(false);
  });
});

describe("NpcPortraitIntentSchema", () => {
  it("accepts prompt, description or both alongside requestedVia", () => {
    expect(
      NpcPortraitIntentSchema.safeParse({
        prompt: "Draw a portrait.",
        requestedVia: "contextInstructions",
      }).success,
    ).toBe(true);
    expect(
      NpcPortraitIntentSchema.safeParse({
        description: "An old mage.",
        requestedVia: "contextInstructions",
      }).success,
    ).toBe(true);
  });
});

describe("ValidatedGenerationInstructionSchema", () => {
  it("accepts resolved instruction shapes", () => {
    const valid = [
      {
        op: "field",
        override: { op: "remove", targetKey: "hit_points" },
      },
      { op: "set_character_name", characterName: "Gruk" },
      {
        op: "request_npc_portrait",
        intent: {
          description: "A veteran.",
          requestedVia: "contextInstructions",
        },
      },
    ];
    for (const instruction of valid) {
      expect(
        ValidatedGenerationInstructionSchema.safeParse(instruction).success,
      ).toBe(true);
    }
  });
});

describe("KeyRemapSchema", () => {
  it("validates a recorded replacement audit", () => {
    const result = KeyRemapSchema.safeParse({
      category: "mechanical",
      fromKey: "constitution",
      toKey: "vigor",
      sourceLabel: "Constitution",
      replacementLabel: "Vigor",
    });
    expect(result.success).toBe(true);
  });
});

describe("RejectedGenerationInstructionSchema", () => {
  it("pairs a proposed instruction with its rejection conflict", () => {
    const result = RejectedGenerationInstructionSchema.safeParse({
      instruction: { op: "set_character_name", value: "Xenk" },
      conflict: conflictOf("INVALID_INSTRUCTION_CONTEXT", null),
    });
    expect(result.success).toBe(true);
  });
});

describe("applyGenerationInstructions", () => {
  it("returns the definition unchanged for an empty instruction list", () => {
    const result = applyGenerationInstructions(pcDefinition, []);
    expect(result.definition).toEqual(pcDefinition);
    expect(result.appliedInstructions).toEqual([]);
    expect(result.keyRemaps).toEqual([]);
    expect(result.conflicts).toEqual(pcDefinition.conflicts);
  });

  describe("ADD", () => {
    it("appends a new mechanical field with context-override provenance", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: {
            op: "add",
            label: "Honor",
            category: "mechanical",
            initialValue: 3,
            permittedValueRange: { min: 1, max: 5 },
          },
        },
      ]);
      const added = result.definition.fields.find(
        (field) => field.canonicalKey === "honor",
      );
      expect(added).toEqual({
        canonicalKey: "honor",
        label: "Honor",
        category: "mechanical",
        explicitValue: 3,
        permittedValueRange: { min: 1, max: 5 },
        provenance: { origins: ["context-override"] },
      });
      expect(result.appliedInstructions).toEqual([
        {
          op: "field",
          override: { op: "add", field: added },
        },
      ]);
      expect(result.definition.overrides).toEqual([
        { op: "add", field: added },
      ]);
    });

    it("appends a new identity trait without invented rule evidence", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: {
            op: "add",
            label: "Alias",
            category: "identity",
            initialValue: "the Gray",
          },
        },
      ]);
      const added = result.definition.fields.find(
        (field) => field.canonicalKey === "alias",
      );
      expect(added?.provenance).toEqual({ origins: ["context-override"] });
      expect(added?.provenance.ruleIds).toBeUndefined();
      expect(added?.provenance.citations).toBeUndefined();
    });

    it("infers the category from a single existing namespace", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10)]),
        [{ op: "field", override: { op: "add", label: "Strength" } }],
      );
      expect(result.rejectedInstructions).toEqual([]);
      const strength = result.definition.fields.find(
        (field) => field.canonicalKey === "strength",
      );
      expect(strength?.category).toBe("mechanical");
    });

    it("infers a fresh field category from the initial value type", () => {
      const numeric = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: { op: "add", label: "Honor", initialValue: 4 },
        },
      ]);
      expect(
        numeric.definition.fields.find(
          (field) => field.canonicalKey === "honor",
        )?.category,
      ).toBe("mechanical");

      const textual = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: { op: "add", label: "Alias", initialValue: "the Gray" },
        },
      ]);
      expect(
        textual.definition.fields.find(
          (field) => field.canonicalKey === "alias",
        )?.category,
      ).toBe("identity");
    });

    it("rejects an ADD that cannot determine its category", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        { op: "field", override: { op: "add", label: "Honor" } },
      ]);
      expect(result.rejectedInstructions).toHaveLength(1);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "AMBIGUOUS_OVERRIDE_TARGET",
      );
    });

    it("marks an identity ADD with numeric value as invalid", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: {
            op: "add",
            label: "Alias",
            category: "identity",
            initialValue: 7,
          },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
    });

    it("fills an existing empty slot and keeps the surviving GUI label", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points")]),
        [
          {
            op: "field",
            override: {
              op: "add",
              label: "Hit  Points",
              category: "mechanical",
              initialValue: 12,
            },
          },
        ],
      );
      expect(result.rejectedInstructions).toEqual([]);
      expect(result.definition.fields).toHaveLength(1);
      const field = result.definition.fields[0]!;
      expect(field.label).toBe("Hit Points");
      expect(field.explicitValue).toBe(12);
      expect(field.provenance.origins).toEqual(["gui", "context-override"]);
    });

    it("keeps the existing field and reports a disagreement on conflicting ADD", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10)]),
        [
          {
            op: "field",
            override: { op: "add", label: "Strength", initialValue: 3 },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT",
      );
      expect(result.definition.fields[0]?.explicitValue).toBe(10);
    });

    it("rejects an ADD that would overflow the field limit", () => {
      const full = makeDefinition(
        Array.from({ length: MAX_TOTAL_FIELDS }, (_, index) =>
          guiMechanical(`Field ${index}`),
        ),
      );
      const result = applyGenerationInstructions(full, [
        {
          op: "field",
          override: { op: "add", label: "Overflow", category: "mechanical" },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_INSTRUCTION_CONTEXT",
      );
    });
  });

  describe("REMOVE", () => {
    it("removes the target field and records an audit trail", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        { op: "field", override: { op: "remove", targetLabel: "Notes" } },
      ]);
      expect(
        result.definition.fields.find(
          (field) => field.canonicalKey === "notes",
        ),
      ).toBeUndefined();
      expect(result.appliedInstructions).toEqual([
        {
          op: "field",
          override: { op: "remove", targetKey: "notes" },
        },
      ]);
    });

    it("rejects a REMOVE whose target does not exist", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        { op: "field", override: { op: "remove", targetLabel: "Vigor" } },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "MISSING_OVERRIDE_TARGET",
      );
      expect(result.definition.fields).toHaveLength(pcDefinition.fields.length);
      expect(result.definition.fields).toEqual(pcDefinition.fields);
    });

    it("rejects a REMOVE that is ambiguous across namespaces", () => {
      const result = applyGenerationInstructions(mechanicalIdentityDefinition, [
        { op: "field", override: { op: "remove", targetLabel: "Notes" } },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "AMBIGUOUS_OVERRIDE_TARGET",
      );
    });

    it("resolves a REMOVE unambiguously when the category is supplied", () => {
      const result = applyGenerationInstructions(mechanicalIdentityDefinition, [
        {
          op: "field",
          override: {
            op: "remove",
            targetLabel: "Notes",
            category: "identity",
          },
        },
      ]);
      expect(
        result.definition.fields.filter(
          (field) => field.canonicalKey === "notes",
        ),
      ).toHaveLength(1);
      expect(result.definition.fields[0]?.category).toBe("mechanical");
    });
  });

  describe("RENAME", () => {
    it("is label-only: canonical identity, mechanics and provenance are preserved", () => {
      const source = rulebookMechanical("Hit Points", {
        range: { min: 1, max: 20 },
      });
      const result = applyGenerationInstructions(makeDefinition([source]), [
        {
          op: "field",
          override: {
            op: "rename",
            sourceLabel: "Hit Points",
            newLabel: "Health",
          },
        },
      ]);
      const renamed = result.definition.fields[0]!;
      expect(renamed.canonicalKey).toBe("hit_points");
      expect(renamed.label).toBe("Health");
      expect(renamed.permittedValueRange).toEqual({ min: 1, max: 20 });
      expect(renamed.provenance).toEqual(source.provenance);
      expect(result.keyRemaps).toEqual([]);
      expect(result.appliedInstructions).toEqual([
        {
          op: "field",
          override: {
            op: "rename",
            sourceKey: "hit_points",
            newLabel: "Health",
          },
        },
      ]);
    });

    it("makes the field reachable by its new label afterwards", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points", 10)]),
        [
          {
            op: "field",
            override: {
              op: "rename",
              sourceLabel: "Hit Points",
              newLabel: "Health",
            },
          },
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Health", value: 15 },
          },
        ],
      );
      expect(result.definition.fields[0]?.explicitValue).toBe(15);
    });
  });

  describe("REPLACE", () => {
    it("moves the field to a new key and records a remap while preserving rule evidence", () => {
      const source = rulebookMechanical("Constitution", {
        range: { min: 3, max: 18 },
      });
      const result = applyGenerationInstructions(makeDefinition([source]), [
        {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: "Constitution",
            replacementLabel: "Vigor",
          },
        },
      ]);
      expect(result.rejectedInstructions).toEqual([]);
      expect(result.definition.fields).toHaveLength(1);
      const vigor = result.definition.fields[0]!;
      expect(vigor.canonicalKey).toBe("vigor");
      expect(vigor.label).toBe("Vigor");
      expect(vigor.category).toBe("mechanical");
      expect(vigor.permittedValueRange).toEqual({ min: 3, max: 18 });
      expect(vigor.provenance.origins).toEqual([
        "rulebook",
        "context-override",
      ]);
      expect(vigor.provenance.ruleIds).toEqual(["rule-1", "rule-2"]);
      expect(vigor.provenance.citations).toHaveLength(2);
      expect(result.keyRemaps).toEqual([
        {
          category: "mechanical",
          fromKey: "constitution",
          toKey: "vigor",
          sourceLabel: "Constitution",
          replacementLabel: "Vigor",
        },
      ]);
      expect(result.definition.overrides).toEqual([
        {
          op: "replace",
          sourceKey: "constitution",
          replacementLabel: "Vigor",
        },
      ]);
    });

    it("merges a REPLACE into an existing same-key field so only one Vigor survives", () => {
      const result = applyGenerationInstructions(
        makeDefinition([
          guiMechanical("Vigor"),
          rulebookMechanical("Constitution", { range: { min: 3, max: 18 } }),
        ]),
        [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Constitution",
              replacementLabel: "Vigor",
            },
          },
        ],
      );
      const vigorFields = result.definition.fields.filter(
        (field) => field.canonicalKey === "vigor",
      );
      expect(vigorFields).toHaveLength(1);
      expect(result.definition.fields).toHaveLength(1);
      expect(
        result.definition.fields.find(
          (field) => field.canonicalKey === "constitution",
        ),
      ).toBeUndefined();
      const vigor = vigorFields[0]!;
      expect(vigor.label).toBe("Vigor");
      expect(vigor.permittedValueRange).toEqual({ min: 3, max: 18 });
      expect(vigor.provenance.origins).toEqual([
        "gui",
        "rulebook",
        "context-override",
      ]);
      expect(vigor.provenance.ruleIds).toEqual(["rule-1", "rule-2"]);
      expect(result.keyRemaps).toEqual([
        {
          category: "mechanical",
          fromKey: "constitution",
          toKey: "vigor",
          sourceLabel: "Constitution",
          replacementLabel: "Vigor",
        },
      ]);
    });

    it("merges a REPLACE when the colliding field precedes the source field in the field list", () => {
      const result = applyGenerationInstructions(
        makeDefinition([
          rulebookMechanical("Constitution", { range: { min: 3, max: 18 } }),
          guiMechanical("Vigor"),
        ]),
        [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Constitution",
              replacementLabel: "Vigor",
            },
          },
        ],
      );
      const vigorFields = result.definition.fields.filter(
        (field) => field.canonicalKey === "vigor",
      );
      expect(vigorFields).toHaveLength(1);
      expect(result.definition.fields).toHaveLength(1);
      expect(
        result.definition.fields.find(
          (field) => field.canonicalKey === "constitution",
        ),
      ).toBeUndefined();
    });

    it("keeps both fields and rejects an incompatible replacement collision", () => {
      const definition = makeDefinition([
        guiMechanical("Vigor", 10),
        rulebookMechanical("Constitution", { explicitValue: 8 }),
      ]);
      const result = applyGenerationInstructions(definition, [
        {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: "Constitution",
            replacementLabel: "Vigor",
          },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT",
      );
      expect(
        result.definition.fields.filter(
          (field) => field.canonicalKey === "vigor",
        ),
      ).toHaveLength(1);
      expect(
        result.definition.fields.find(
          (field) => field.canonicalKey === "constitution",
        ),
      ).toBeDefined();
      expect(result.keyRemaps).toEqual([]);
    });

    it("rejects a REPLACE whose replacement label canonicalizes to the same key", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points")]),
        [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Hit Points",
              replacementLabel: "Hit  Points",
            },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
      );
    });

    it("resolves a later instruction through the recorded remap", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Constitution")]),
        [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Constitution",
              replacementLabel: "Vigor",
            },
          },
          {
            op: "field",
            override: {
              op: "set_value",
              targetLabel: "Constitution",
              value: 9,
            },
          },
        ],
      );
      expect(result.rejectedInstructions).toEqual([]);
      const vigor = result.definition.fields.find(
        (field) => field.canonicalKey === "vigor",
      );
      expect(vigor?.explicitValue).toBe(9);
    });

    it("terminates through a two-hop remap cycle and keeps the field addressable", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Agility"), guiMechanical("Speed")]),
        [
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Agility",
              replacementLabel: "Speed",
            },
          },
          {
            op: "field",
            override: {
              op: "replace",
              sourceLabel: "Speed",
              replacementLabel: "Agility",
            },
          },
          {
            op: "field",
            override: {
              op: "constrain",
              targetLabel: "Agility",
              min: 1,
              max: 20,
            },
          },
        ],
      );
      expect(result.rejectedInstructions).toEqual([]);
      expect(result.keyRemaps).toHaveLength(2);
      expect(
        result.keyRemaps.map((remap) => [remap.fromKey, remap.toKey]),
      ).toEqual([
        ["agility", "speed"],
        ["speed", "agility"],
      ]);
      expect(result.appliedInstructions).toHaveLength(3);
      const agility = result.definition.fields.find(
        (field) => field.canonicalKey === "agility",
      );
      expect(result.definition.fields).toHaveLength(1);
      expect(agility?.label).toBe("Agility");
      expect(agility?.permittedValueRange).toEqual({ min: 1, max: 20 });
    });
  });

  describe("CONSTRAIN", () => {
    it("sets the full range and adds a context-override origin", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points", 12)]),
        [
          {
            op: "field",
            override: {
              op: "constrain",
              targetLabel: "Hit Points",
              min: 1,
              max: 18,
            },
          },
        ],
      );
      const field = result.definition.fields[0]!;
      expect(field.permittedValueRange).toEqual({ min: 1, max: 18 });
      expect(field.provenance.origins).toEqual(["gui", "context-override"]);
    });

    it("substitutes a missing side with the existing baseline", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points", 12, { min: 1, max: 20 })]),
        [
          {
            op: "field",
            override: { op: "constrain", targetLabel: "Hit Points", max: 18 },
          },
        ],
      );
      expect(result.definition.fields[0]?.permittedValueRange).toEqual({
        min: 1,
        max: 18,
      });
    });

    it("rejects a one-sided constraint with no baseline range", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points")]),
        [
          {
            op: "field",
            override: { op: "constrain", targetLabel: "Hit Points", min: 1 },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
    });

    it("rejects a resulting inverted range", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points", 12, { min: 1, max: 20 })]),
        [
          {
            op: "field",
            override: { op: "constrain", targetLabel: "Hit Points", max: 0 },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
      expect(result.definition.fields[0]?.permittedValueRange).toEqual({
        min: 1,
        max: 20,
      });
    });

    it("rejects CONSTRAIN on an identity trait", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiIdentity("Notes")]),
        [
          {
            op: "field",
            override: {
              op: "constrain",
              targetLabel: "Notes",
              min: 1,
              max: 10,
            },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
    });

    it("reports an explicit value outside the new range via INVALID_CONSTRAINT_VALUE", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Hit Points", 25)]),
        [
          {
            op: "field",
            override: {
              op: "constrain",
              targetLabel: "Hit Points",
              min: 1,
              max: 18,
            },
          },
        ],
      );
      expect(result.rejectedInstructions).toEqual([]);
      const conflict = result.conflicts.find(
        (candidate) => candidate.code === "INVALID_CONSTRAINT_VALUE",
      );
      expect(conflict?.canonicalKey).toBe("hit_points");
      expect(result.definition.fields[0]?.explicitValue).toBe(25);
    });
  });

  describe("SET_VALUE", () => {
    it("overrides the lower-level explicit value and adds a context-override origin", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10)]),
        [
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Strength", value: 12 },
          },
        ],
      );
      const field = result.definition.fields[0]!;
      expect(field.explicitValue).toBe(12);
      expect(field.provenance.origins).toEqual(["gui", "context-override"]);
      expect(result.definition.overrides).toEqual([
        { op: "set_value", targetKey: "strength", value: 12 },
      ]);
    });

    it("clears an explicit value with null", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10)]),
        [
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Strength", value: null },
          },
        ],
      );
      expect(result.definition.fields[0]?.explicitValue).toBeNull();
    });

    it("rejects a numeric value on an identity trait", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiIdentity("Notes")]),
        [
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Notes", value: 3 },
          },
        ],
      );
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
    });

    it("keeps the value and reports INVALID_CONSTRAINT_VALUE when outside the range", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10, { min: 1, max: 18 })]),
        [
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Strength", value: 25 },
          },
        ],
      );
      expect(result.appliedInstructions).toHaveLength(1);
      expect(result.definition.fields[0]?.explicitValue).toBe(25);
      expect(
        result.conflicts.find(
          (candidate) => candidate.code === "INVALID_CONSTRAINT_VALUE",
        )?.canonicalKey,
      ).toBe("strength");
    });

    it("rejects a SET_VALUE with a missing target", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Vigor", value: 3 },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "MISSING_OVERRIDE_TARGET",
      );
    });
  });

  describe("SET_CHARACTER_NAME", () => {
    it("replaces the LEVEL-2 name on a PC sheet", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiIdentity("Notes")], { characterName: "Arya" }),
        [{ op: "set_character_name", value: "  Gruk  " }],
      );
      expect(result.definition.characterName).toBe("Gruk");
      expect(result.appliedInstructions).toEqual([
        { op: "set_character_name", characterName: "Gruk" },
      ]);
    });

    it("sets the name on an NPC sheet too", () => {
      const result = applyGenerationInstructions(
        makeDefinition([], { mode: "npc" }),
        [{ op: "set_character_name", value: "Xenk" }],
      );
      expect(result.definition.characterName).toBe("Xenk");
    });
  });

  describe("REQUEST_NPC_PORTRAIT", () => {
    it("records the portrait intent for an NPC sheet", () => {
      const intent = NpcPortraitIntentSchema.parse({
        description: "A scarred veteran in a wolf-skin cloak.",
        requestedVia: "contextInstructions",
      });
      const result = applyGenerationInstructions(
        makeDefinition([], { mode: "npc" }),
        [{ op: "request_npc_portrait", intent }],
      );
      expect(result.npcPortraitIntent).toEqual(intent);
      expect(result.appliedInstructions).toEqual([
        { op: "request_npc_portrait", intent },
      ]);
    });

    it("keeps the last portrait request when several arrive", () => {
      const result = applyGenerationInstructions(
        makeDefinition([], { mode: "npc" }),
        [
          {
            op: "request_npc_portrait",
            intent: {
              description: "First.",
              requestedVia: "contextInstructions",
            },
          },
          {
            op: "request_npc_portrait",
            intent: {
              description: "Second.",
              requestedVia: "contextInstructions",
            },
          },
        ],
      );
      expect(result.npcPortraitIntent?.description).toBe("Second.");
    });

    it("rejects a portrait request on a PC sheet", () => {
      const result = applyGenerationInstructions(pcDefinition, [
        {
          op: "request_npc_portrait",
          intent: {
            description: "A hero.",
            requestedVia: "contextInstructions",
          },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_INSTRUCTION_CONTEXT",
      );
      expect(result.npcPortraitIntent).toBeUndefined();
    });
  });

  describe("order and independence", () => {
    it("applies instructions in sequence order", () => {
      const result = applyGenerationInstructions(makeDefinition([]), [
        {
          op: "field",
          override: { op: "add", label: "Strength", category: "mechanical" },
        },
        {
          op: "field",
          override: { op: "add", label: "Dexterity", category: "mechanical" },
        },
      ]);
      expect(
        result.definition.fields.map((field) => field.canonicalKey),
      ).toEqual(["strength", "dexterity"]);
    });

    it("lets a later instruction operate on an earlier ADD", () => {
      const result = applyGenerationInstructions(makeDefinition([]), [
        {
          op: "field",
          override: { op: "add", label: "Level", category: "mechanical" },
        },
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Level", value: 3 },
        },
      ]);
      expect(
        result.definition.fields.find((field) => field.canonicalKey === "level")
          ?.explicitValue,
      ).toBe(3);
    });

    it("continues after a rejected instruction instead of stopping the sequence", () => {
      const result = applyGenerationInstructions(makeDefinition([]), [
        { op: "field", override: { op: "remove", targetLabel: "Missing" } },
        {
          op: "field",
          override: { op: "add", label: "Honor", category: "mechanical" },
        },
      ]);
      expect(result.rejectedInstructions).toHaveLength(1);
      expect(result.appliedInstructions).toHaveLength(1);
      expect(
        result.definition.fields.find(
          (field) => field.canonicalKey === "honor",
        ),
      ).toBeDefined();
    });
  });

  describe("prior conflict reconciliation", () => {
    it("drops divergence conflicts for keys the instructions modified", () => {
      const definition = makeDefinition([guiMechanical("Strength", 10)], {
        conflicts: [
          conflictOf("EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT", "strength", [
            "Strength",
          ]),
          conflictOf("DUPLICATE_CANONICAL_KEY_INCOMPATIBLE", "not_touched", [
            "Other",
          ]),
        ],
      });
      const result = applyGenerationInstructions(definition, [
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Strength", value: 12 },
        },
      ]);
      const keys = result.conflicts.map((conflict) => conflict.canonicalKey);
      expect(keys).not.toContain("strength");
      expect(keys).toContain("not_touched");
    });

    it("drops conflicts of a REMOVED field", () => {
      const definition = makeDefinition(
        [guiMechanical("Strength", 10), guiMechanical("Dexterity")],
        {
          conflicts: [conflictOf("UNRESOLVED_SOURCE_COLLISION", "strength")],
        },
      );
      const result = applyGenerationInstructions(definition, [
        { op: "field", override: { op: "remove", targetLabel: "Strength" } },
      ]);
      expect(
        result.conflicts.find(
          (conflict) => conflict.canonicalKey === "strength",
        ),
      ).toBeUndefined();
    });

    it("recomputes INVALID_CONSTRAINT_VALUE conflicts against final fields", () => {
      const definition = makeDefinition(
        [guiMechanical("Hit Points", 30, { min: 1, max: 18 })],
        {
          conflicts: [
            conflictOf("INVALID_CONSTRAINT_VALUE", "hit_points", [
              "Hit Points",
            ]),
          ],
        },
      );
      const result = applyGenerationInstructions(definition, [
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Hit Points", value: 12 },
        },
      ]);
      expect(
        result.conflicts.find(
          (conflict) => conflict.code === "INVALID_CONSTRAINT_VALUE",
        ),
      ).toBeUndefined();
    });

    it("re-adds an INVALID_CONSTRAINT_VALUE when the final value is still outside", () => {
      const definition = makeDefinition(
        [guiMechanical("Hit Points", 12, { min: 1, max: 18 })],
        {
          conflicts: [
            conflictOf("INVALID_CONSTRAINT_VALUE", "hit_points", [
              "Hit Points",
            ]),
          ],
        },
      );
      const result = applyGenerationInstructions(definition, [
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Hit Points", value: 30 },
        },
      ]);
      expect(
        result.conflicts.filter(
          (conflict) => conflict.code === "INVALID_CONSTRAINT_VALUE",
        ),
      ).toHaveLength(1);
      expect(result.conflicts[0]?.canonicalKey).toBe("hit_points");
    });
  });

  describe("respected limits", () => {
    it("rejects field instructions once the explicit override budget is exhausted", () => {
      const saturated = makeDefinition([guiMechanical("Strength")], {
        overrides: Array.from(
          { length: MAX_EXPLICIT_INPUT_OVERRIDES },
          (_, index) => ({
            op: "set_value",
            targetKey: `x_${index}`,
            value: null,
          }),
        ),
      });
      const result = applyGenerationInstructions(saturated, [
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Strength", value: 4 },
        },
      ]);
      expect(result.rejectedInstructions[0]?.conflict.code).toBe(
        "INVALID_INSTRUCTION_CONTEXT",
      );
    });
  });

  describe("result contract", () => {
    it("emits a schema-valid application result", () => {
      const result = applyGenerationInstructions(
        makeDefinition([guiMechanical("Strength", 10)]),
        [
          {
            op: "field",
            override: { op: "set_value", targetLabel: "Strength", value: 14 },
          },
          { op: "set_character_name", value: "Gruk" },
        ],
      );
      expect(
        GenerationInstructionApplicationResultSchema.safeParse(result).success,
      ).toBe(true);
      expect(result.conflicts).toEqual(result.definition.conflicts);
    });

    it("includes the three new conflict codes in the shared vocabulary", () => {
      expect(GENERATION_CONFLICT_CODES).toContain("MISSING_OVERRIDE_TARGET");
      expect(GENERATION_CONFLICT_CODES).toContain(
        "INVALID_OVERRIDE_CONSTRAINTS",
      );
      expect(GENERATION_CONFLICT_CODES).toContain(
        "INVALID_INSTRUCTION_CONTEXT",
      );
    });
  });
});
