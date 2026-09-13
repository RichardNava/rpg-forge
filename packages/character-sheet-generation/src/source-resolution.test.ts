import { describe, expect, it } from "vitest";
import {
  canonicalizeFieldLabel,
  ExplicitSheetOverrideSchema,
  GENERATION_CONFLICT_CODES,
  GenerationConflictSchema,
  NormalizedSheetDefinitionSchema,
  ProposedSheetOverrideSchema,
  SheetFieldSourceProvenanceSchema,
  SourceResolvedFieldSchema,
} from "./source-resolution.js";
import { CanonicalFieldKeySchema } from "./source-resolution.js";

const rulebookProvenance = {
  origins: ["rulebook"],
  ruleIds: ["rule-1"],
  citations: [
    {
      sourceId: "src-1",
      pageStart: 10,
      pageEnd: 12,
      section: "Chapter 3",
      chunkId: null,
    },
  ],
};

const guiProvenance = { origins: ["gui"] };

const mechanicalField = {
  canonicalKey: "hit_points",
  label: "Hit Points",
  category: "mechanical",
  provenance: rulebookProvenance,
};

const identityField = {
  canonicalKey: "notes",
  label: "Notes",
  category: "identity",
  provenance: guiProvenance,
};

describe("canonicalizeFieldLabel", () => {
  it("converges case and surrounding whitespace", () => {
    expect(canonicalizeFieldLabel("Strength")).toBe("strength");
    expect(canonicalizeFieldLabel("  strength  ")).toBe("strength");
    expect(canonicalizeFieldLabel("STRENGTH")).toBe("strength");
  });

  it("keeps semantically distinct labels distinct", () => {
    expect(canonicalizeFieldLabel("Vigor")).not.toBe(
      canonicalizeFieldLabel("Constitution"),
    );
  });

  it("never collapses similar-but-distinct labels", () => {
    expect(canonicalizeFieldLabel("Hit Points")).not.toBe(
      canonicalizeFieldLabel("Hitpoints"),
    );
    expect(canonicalizeFieldLabel("Hit Points")).toBe("hit_points");
    expect(canonicalizeFieldLabel("Hitpoints")).toBe("hitpoints");
  });

  it("normalizes unicode via NFKD folding", () => {
    expect(canonicalizeFieldLabel("Énergie")).toBe("energie");
  });

  it("folds accents deterministically under the folding policy", () => {
    expect(canonicalizeFieldLabel("Énergie")).toBe(
      canonicalizeFieldLabel("energie"),
    );
  });

  it("gives punctuation-only labels a deterministic fingerprint key", () => {
    const key = canonicalizeFieldLabel("!!! ???");
    expect(key).toMatch(/^field_[0-9a-f]{12}$/);
    expect(canonicalizeFieldLabel("!!! ???")).toBe(key);
    expect(canonicalizeFieldLabel("?!? !!!")).toMatch(/^field_[0-9a-f]{12}$/);
  });

  it("keeps distinct non-Latin labels distinct", () => {
    const combat = canonicalizeFieldLabel("戦闘");
    const magic = canonicalizeFieldLabel("魔法");
    expect(combat).not.toBe(magic);
    expect(combat).toMatch(/^field_[0-9a-f]{12}$/);
    expect(magic).toMatch(/^field_[0-9a-f]{12}$/);
  });

  it("keeps distinct Cyrillic labels distinct", () => {
    const will = canonicalizeFieldLabel("Воля");
    const power = canonicalizeFieldLabel("Сила");
    expect(will).not.toBe(power);
    expect(will).toMatch(/^field_[0-9a-f]{12}$/);
    expect(power).toMatch(/^field_[0-9a-f]{12}$/);
  });

  it("distinguishes labels that share a slug but differ only in stripped characters", () => {
    expect(canonicalizeFieldLabel("Strength!")).not.toBe(
      canonicalizeFieldLabel("Strength."),
    );
    expect(canonicalizeFieldLabel("Strength!")).toMatch(
      /^strength_[0-9a-f]{12}$/,
    );
  });

  it("never collapses unrelated labels via lossy unicode normalization", () => {
    expect(canonicalizeFieldLabel("魔法")).not.toBe(
      canonicalizeFieldLabel("魔力"),
    );
    expect(canonicalizeFieldLabel("Воля")).not.toBe(
      canonicalizeFieldLabel("Воля!"),
    );
    expect(canonicalizeFieldLabel("Magic 魔法")).not.toBe(
      canonicalizeFieldLabel("Magic"),
    );
    expect(canonicalizeFieldLabel("Magic 魔法")).toBe(
      canonicalizeFieldLabel("  magic   魔法  "),
    );
  });

  it("prefixes digit-leading labels", () => {
    expect(canonicalizeFieldLabel("123 Strength")).toBe("field_123_strength");
    expect(canonicalizeFieldLabel("123")).toBe("field_123");
  });

  it("collapses repeated whitespace into a single underscore", () => {
    expect(canonicalizeFieldLabel("  Armor  Class   ")).toBe("armor_class");
  });

  it("truncates overlong labels within the canonical key limit", () => {
    const key = canonicalizeFieldLabel("n".repeat(200));
    expect(key.length).toBeLessThanOrEqual(64);
    expect(canonicalizeFieldLabel("n".repeat(200))).toBe(key);
  });

  it("keeps distinct overlong labels distinct after truncation", () => {
    expect(canonicalizeFieldLabel("n".repeat(200))).not.toBe(
      canonicalizeFieldLabel("m".repeat(200)),
    );
    const diffAfterBudget = "a".repeat(120) + "z" + "a".repeat(79);
    expect(canonicalizeFieldLabel(diffAfterBudget)).not.toBe(
      canonicalizeFieldLabel("a".repeat(200)),
    );
  });

  it("always yields a canonical key", () => {
    for (const label of [
      "Strength",
      "  ...  ",
      "123",
      "a",
      "x".repeat(300),
      "НР",
      "戦闘",
      "Воля",
      "Magic 魔法",
    ]) {
      const key = canonicalizeFieldLabel(label);
      expect(CanonicalFieldKeySchema.safeParse(key).success).toBe(true);
    }
  });
});

describe("SheetFieldSourceProvenanceSchema", () => {
  it("accepts GUI-only provenance without rule evidence", () => {
    const result = SheetFieldSourceProvenanceSchema.safeParse(guiProvenance);
    expect(result.success).toBe(true);
  });

  it("rejects rule evidence on GUI-only provenance", () => {
    const result = SheetFieldSourceProvenanceSchema.safeParse({
      origins: ["gui"],
      ruleIds: ["rule-1"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts rulebook provenance with rule ids and citations", () => {
    const result =
      SheetFieldSourceProvenanceSchema.safeParse(rulebookProvenance);
    expect(result.success).toBe(true);
  });

  it("rejects rule evidence on ai-default provenance", () => {
    const result = SheetFieldSourceProvenanceSchema.safeParse({
      origins: ["ai-default"],
      citations: [rulebookProvenance.citations[0]],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty origin set", () => {
    const result = SheetFieldSourceProvenanceSchema.safeParse({ origins: [] });
    expect(result.success).toBe(false);
  });
});

describe("SourceResolvedFieldSchema", () => {
  it("accepts a mechanical field with an explicit value and range together", () => {
    const field = SourceResolvedFieldSchema.parse({
      ...mechanicalField,
      explicitValue: 30,
      permittedValueRange: { min: 1, max: 50 },
    });
    expect(field.explicitValue).toBe(30);
    expect(field.permittedValueRange).toEqual({ min: 1, max: 50 });
  });

  it("accepts an identity trait with a textual value", () => {
    const field = SourceResolvedFieldSchema.parse({
      ...identityField,
      explicitValue: "Orphan of the vale",
    });
    expect(field.explicitValue).toBe("Orphan of the vale");
  });

  it("rejects numeric explicit values on identity traits", () => {
    const result = SourceResolvedFieldSchema.safeParse({
      ...identityField,
      explicitValue: 7,
    });
    expect(result.success).toBe(false);
  });

  it("rejects numeric bounds on identity traits", () => {
    const result = SourceResolvedFieldSchema.safeParse({
      ...identityField,
      permittedValueRange: { min: 0, max: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an inverted permitted range", () => {
    const result = SourceResolvedFieldSchema.safeParse({
      ...mechanicalField,
      permittedValueRange: { min: 50, max: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed canonical keys", () => {
    const result = SourceResolvedFieldSchema.safeParse({
      ...mechanicalField,
      canonicalKey: "Hit Points",
    });
    expect(result.success).toBe(false);
  });

  it("rejects provenance without a rulebook origin carrying rule ids", () => {
    const result = SourceResolvedFieldSchema.safeParse({
      ...mechanicalField,
      provenance: { origins: ["gui"], ruleIds: ["rule-1"] },
    });
    expect(result.success).toBe(false);
  });
});

describe("ProposedSheetOverrideSchema", () => {
  it("accepts each proposed operation shape", () => {
    const valid = [
      { op: "add", label: "Honor", category: "mechanical" },
      { op: "remove", targetLabel: "Honor" },
      { op: "rename", sourceLabel: "Honor", newLabel: "Standing" },
      { op: "replace", sourceLabel: "Honor", replacementLabel: "Reputation" },
      { op: "constrain", targetLabel: "Hit Points", min: 1, max: 50 },
      { op: "set_value", targetLabel: "Level", value: 3 },
      { op: "set_value", targetLabel: "Title", value: null },
    ];
    for (const proposal of valid) {
      expect(ProposedSheetOverrideSchema.safeParse(proposal).success).toBe(
        true,
      );
    }
  });

  it("rejects a rename that does not change the label", () => {
    const result = ProposedSheetOverrideSchema.safeParse({
      op: "rename",
      sourceLabel: "Honor",
      newLabel: "Honor",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a replace that does not change the label", () => {
    const result = ProposedSheetOverrideSchema.safeParse({
      op: "replace",
      sourceLabel: "Honor",
      replacementLabel: "Honor",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a constrain without any bound", () => {
    const result = ProposedSheetOverrideSchema.safeParse({
      op: "constrain",
      targetLabel: "Hit Points",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an inverted constrain range", () => {
    const result = ProposedSheetOverrideSchema.safeParse({
      op: "constrain",
      targetLabel: "Hit Points",
      min: 50,
      max: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown operations", () => {
    const result = ProposedSheetOverrideSchema.safeParse({
      op: "destroy",
      targetLabel: "Honor",
    });
    expect(result.success).toBe(false);
  });
});

describe("ExplicitSheetOverrideSchema", () => {
  it("accepts an ADD carrying the fully resolved field", () => {
    const result = ExplicitSheetOverrideSchema.safeParse({
      op: "add",
      field: mechanicalField,
    });
    expect(result.success).toBe(true);
  });

  it("accepts key-targeted REMOVE, RENAME, REPLACE and SET_VALUE", () => {
    const valid = [
      { op: "remove", targetKey: "hit_points" },
      { op: "rename", sourceKey: "hit_points", newLabel: "Health" },
      { op: "replace", sourceKey: "hit_points", replacementLabel: "Vitality" },
      { op: "set_value", targetKey: "level", value: 3 },
      { op: "set_value", targetKey: "title", value: null },
    ];
    for (const override of valid) {
      expect(ExplicitSheetOverrideSchema.safeParse(override).success).toBe(
        true,
      );
    }
  });

  it("accepts CONSTRAIN with a single bound", () => {
    const result = ExplicitSheetOverrideSchema.safeParse({
      op: "constrain",
      targetKey: "hit_points",
      min: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects CONSTRAIN with no bound and an inverted range", () => {
    const none = ExplicitSheetOverrideSchema.safeParse({
      op: "constrain",
      targetKey: "hit_points",
    });
    expect(none.success).toBe(false);

    const inverted = ExplicitSheetOverrideSchema.safeParse({
      op: "constrain",
      targetKey: "hit_points",
      min: 50,
      max: 1,
    });
    expect(inverted.success).toBe(false);
  });

  it("rejects non-canonical keys", () => {
    const result = ExplicitSheetOverrideSchema.safeParse({
      op: "remove",
      targetKey: "Hit Points",
    });
    expect(result.success).toBe(false);
  });
});

describe("GenerationConflictSchema", () => {
  it("exposes the full conflict vocabulary", () => {
    expect(GENERATION_CONFLICT_CODES).toEqual([
      "AMBIGUOUS_OVERRIDE_TARGET",
      "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT",
      "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
      "INVALID_CONSTRAINT_VALUE",
      "UNRESOLVED_SOURCE_COLLISION",
      "INVALID_INSTRUCTION_CONTEXT",
      "INVALID_OVERRIDE_CONSTRAINTS",
      "MISSING_OVERRIDE_TARGET",
      "AMBIGUOUS_DERIVATION_CATEGORY",
      "INVALID_DERIVATION_FIELD",
      "NPC_MECHANICAL_VALUE_FORBIDDEN",
      "FABRICATED_RULE_EVIDENCE",
      "FOREIGN_CITATION_EVIDENCE",
      "DUPLICATE_TEMPLATE_FIELD_LABEL",
      "TEMPLATE_MODE_MISMATCH",
      "TEMPLATE_CATEGORY_DISAGREEMENT",
      "TEMPLATE_BOUND_DISAGREEMENT",
    ]);
  });

  it("accepts a conflict referencing a canonical key", () => {
    const result = GenerationConflictSchema.safeParse({
      code: "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
      canonicalKey: "hit_points",
      message: "GUI and rulebook disagree on the Hit Points bounds.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown conflict codes", () => {
    const result = GenerationConflictSchema.safeParse({
      code: "FATAL_MAYHEM",
      canonicalKey: null,
      message: "…",
    });
    expect(result.success).toBe(false);
  });

  it("rejects blank conflict messages", () => {
    const result = GenerationConflictSchema.safeParse({
      code: "UNRESOLVED_SOURCE_COLLISION",
      canonicalKey: null,
      message: "   ",
    });
    expect(result.success).toBe(false);
  });
});

describe("NormalizedSheetDefinitionSchema", () => {
  it("accepts a minimal PC definition with safe defaults", () => {
    const definition = NormalizedSheetDefinitionSchema.parse({
      schemaVersion: 1,
      mode: "pc",
    });
    expect(definition.characterName).toBeNull();
    expect(definition.fields).toEqual([]);
    expect(definition.overrides).toEqual([]);
    expect(definition.conflicts).toEqual([]);
    expect(definition.npc).toBeUndefined();
  });

  it("rejects a specVersion other than 1", () => {
    const result = NormalizedSheetDefinitionSchema.safeParse({
      schemaVersion: 2,
      mode: "pc",
    });
    expect(result.success).toBe(false);
  });

  it("requires an NPC block for npc mode", () => {
    const result = NormalizedSheetDefinitionSchema.safeParse({
      schemaVersion: 1,
      mode: "npc",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an NPC block for npc mode with nullable threat", () => {
    const definition = NormalizedSheetDefinitionSchema.parse({
      schemaVersion: 1,
      mode: "npc",
      npc: { disposition: "enemy", threat: "boss" },
    });
    expect(definition.npc).toEqual({ disposition: "enemy", threat: "boss" });

    const ally = NormalizedSheetDefinitionSchema.parse({
      schemaVersion: 1,
      mode: "npc",
      npc: { disposition: "ally", threat: null },
    });
    expect(ally.npc?.threat).toBeNull();
  });

  it("forbids an NPC block on a PC definition", () => {
    const result = NormalizedSheetDefinitionSchema.safeParse({
      schemaVersion: 1,
      mode: "pc",
      npc: { disposition: "enemy", threat: "weak" },
    });
    expect(result.success).toBe(false);
  });

  it("preserves a supplied character name", () => {
    const definition = NormalizedSheetDefinitionSchema.parse({
      schemaVersion: 1,
      mode: "pc",
      characterName: "Arya Stark",
    });
    expect(definition.characterName).toBe("Arya Stark");
  });

  it("caps the field count at the maximum", () => {
    const fields = Array.from({ length: 193 }, () => mechanicalField);
    const result = NormalizedSheetDefinitionSchema.safeParse({
      schemaVersion: 1,
      mode: "pc",
      fields,
    });
    expect(result.success).toBe(false);
  });

  it("keeps identity and mechanical namespaces distinguishable", () => {
    const definition = NormalizedSheetDefinitionSchema.parse({
      schemaVersion: 1,
      mode: "pc",
      fields: [
        { ...mechanicalField, canonicalKey: "notes", label: "Notes" },
        { ...identityField, canonicalKey: "notes", label: "Notes" },
      ],
    });
    const [mechanical, identity] = definition.fields;
    expect(mechanical?.category).toBe("mechanical");
    expect(identity?.category).toBe("identity");
  });
});
