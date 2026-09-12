import { describe, expect, it } from "vitest";
import { canonicalizeFieldLabel } from "./source-resolution.js";
import {
  parseRulebookDerivedDefinition,
  validateRulebookDerivedDefinition,
  type RulebookDerivedDefinition,
  type RulebookDerivedField,
} from "./rulebook-derivation.js";
import {
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
  SOURCE_ID,
} from "./test/fakes.js";

const HIT_POINTS_RANGE = { min: 1, max: 20 };

const GENUINE_ATTACK_CITATION = {
  sourceId: SOURCE_ID,
  pageStart: 42,
  pageEnd: 42,
  section: "Combat",
  chunkId: "chunk-combat-1",
};

function proposal(fields: RulebookDerivedField[]): RulebookDerivedDefinition {
  return { schemaVersion: 1, fields };
}

function mechanicalField(
  label: string,
  overrides: Partial<RulebookDerivedField> = {},
): RulebookDerivedField {
  return {
    label,
    category: "mechanical",
    permittedValueRange: HIT_POINTS_RANGE,
    evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
    ...overrides,
  };
}

describe("parseRulebookDerivedDefinition", () => {
  it("accepts a schema-conformant proposal", () => {
    const parsed = parseRulebookDerivedDefinition(
      JSON.stringify(proposal([mechanicalField("Hit Points")])),
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects a provider-carried canonicalKey as unknown", () => {
    const parsed = parseRulebookDerivedDefinition(
      JSON.stringify(
        proposal([
          {
            label: "Hit Points",
            category: "mechanical",
            canonicalKey: "hit_points",
            permittedValueRange: HIT_POINTS_RANGE,
            evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
          } as unknown as RulebookDerivedField,
        ]),
      ),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("Unrecognized key");
    }
  });

  it("rejects an inverted numeric range at the schema gate without clipping", () => {
    const parsed = parseRulebookDerivedDefinition(
      JSON.stringify(
        proposal([
          mechanicalField("Hit Points", {
            permittedValueRange: { min: 20, max: 1 },
          }),
        ]),
      ),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain(
        "A numeric range max must be greater than or equal to min.",
      );
    }
  });
});

describe("validateRulebookDerivedDefinition", () => {
  it("converts an evidence-backed proposal to a server-keyed source field", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([mechanicalField("Hit Points")]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.fields).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    const field = result.fields[0]!;
    expect(field).toMatchObject({
      canonicalKey: "hit_points",
      label: "Hit Points",
      category: "mechanical",
      permittedValueRange: HIT_POINTS_RANGE,
    });
    expect(field.provenance.origins).toEqual(["rulebook"]);
    expect(field.provenance.ruleIds).toEqual([RULE_HIT_POINTS_ID]);
  });

  it("derives canonicalKey deterministically from the label server-side", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        mechanicalField("Hit Points"),
        mechanicalField("  HIT POINTS remote label ", {
          permittedValueRange: { min: 1, max: 30 },
        }),
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.conflicts).toEqual([]);
    expect(result.fields.map((field) => field.canonicalKey)).toEqual([
      "hit_points",
      "hit_points_remote_label",
    ]);
    expect(result.fields.map((field) => field.canonicalKey)).toEqual(
      result.fields.map((field) => canonicalizeFieldLabel(field.label)),
    );
  });

  it("auto-derives genuine citations when the proposal omits them", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        mechanicalField("Attack Roll", {
          permittedValueRange: { min: 1, max: 20 },
          evidence: { ruleIds: [RULE_ATTACK_ID] },
        }),
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.conflicts).toEqual([]);
    const field = result.fields[0]!;
    expect(field.provenance.citations).toEqual([GENUINE_ATTACK_CITATION]);
  });

  it("rejects fabricated rule evidence with a visible conflict and no field", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        mechanicalField("Hit Points", {
          evidence: { ruleIds: ["rule-does-not-exist"] },
        }),
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.fields).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      code: "FABRICATED_RULE_EVIDENCE",
      canonicalKey: "hit_points",
      sourceLabels: ["Hit Points"],
    });
  });

  it("rejects citation evidence none of the referenced rules provide", () => {
    const foreignCitation = {
      sourceId: SOURCE_ID,
      pageStart: 99,
      pageEnd: 99,
      section: "Enemies",
      chunkId: "chunk-enemies-1",
    };
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        mechanicalField("Attack Roll", {
          permittedValueRange: { min: 1, max: 20 },
          evidence: {
            ruleIds: [RULE_ATTACK_ID],
            citations: [foreignCitation],
          },
        }),
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.fields).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.code).toBe("FOREIGN_CITATION_EVIDENCE");
  });

  it("accepts citations that are genuine and dedupes them deterministically", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        mechanicalField("Attack Roll", {
          permittedValueRange: { min: 1, max: 20 },
          evidence: {
            ruleIds: [RULE_ATTACK_ID],
            citations: [GENUINE_ATTACK_CITATION, GENUINE_ATTACK_CITATION],
          },
        }),
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.conflicts).toEqual([]);
    expect(result.fields[0]?.provenance.citations).toEqual([
      GENUINE_ATTACK_CITATION,
    ]);
  });

  it("rejects an explicit numeric value on an NPC mechanical field", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([mechanicalField("Hit Points", { explicitValue: 6 })]),
      context: makeRulesContext(),
      mode: "npc",
    });

    expect(result.fields).toHaveLength(0);
    expect(result.conflicts[0]?.code).toBe("NPC_MECHANICAL_VALUE_FORBIDDEN");
  });

  it("rejects a numeric value or range on an identity trait", () => {
    const withValue = validateRulebookDerivedDefinition({
      proposal: proposal([
        {
          label: "Homeland",
          category: "identity",
          explicitValue: 4,
          evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
        },
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });
    expect(withValue.conflicts[0]?.code).toBe("INVALID_DERIVATION_FIELD");

    const withRange = validateRulebookDerivedDefinition({
      proposal: proposal([
        {
          label: "Homeland",
          category: "identity",
          permittedValueRange: HIT_POINTS_RANGE,
          evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
        },
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });
    expect(withRange.conflicts[0]?.code).toBe("INVALID_DERIVATION_FIELD");
  });

  it("rejects a proposal whose category cannot be determined", () => {
    const result = validateRulebookDerivedDefinition({
      proposal: proposal([
        {
          label: "Mystery",
          explicitValue: null,
          evidence: { ruleIds: [RULE_HIT_POINTS_ID] },
        },
      ]),
      context: makeRulesContext(),
      mode: "pc",
    });

    expect(result.fields).toHaveLength(0);
    expect(result.conflicts[0]).toMatchObject({
      code: "AMBIGUOUS_DERIVATION_CATEGORY",
      canonicalKey: "mystery",
    });
  });
});
