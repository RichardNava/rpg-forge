import { describe, expect, it } from "vitest";
import {
  parseCalculationCandidates,
  parseFieldCandidates,
  parseSectionPlan,
  validateCalculationCandidatesAgainstContext,
  validateFieldCandidatesAgainstContext,
  validateSectionPlanAgainstContext,
} from "./generate.js";
import {
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
} from "./test/fakes.js";

const VALID_PLAN_JSON = JSON.stringify({
  mode: "player",
  sections: [
    {
      key: "attributes",
      title: "Attributes",
      purpose: "Core attributes derived from the rules.",
      ruleIds: [RULE_ATTACK_ID],
    },
    {
      key: "combat",
      title: "Combat",
      purpose: "Combat statistics.",
      ruleIds: [RULE_HIT_POINTS_ID],
    },
  ],
});

describe("parseSectionPlan", () => {
  it("accepts a structurally valid plan", () => {
    const parsed = parseSectionPlan(VALID_PLAN_JSON);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.plan.mode).toBe("player");
      expect(parsed.plan.sections).toHaveLength(2);
    }
  });

  it("rejects non-JSON output", () => {
    const parsed = parseSectionPlan("not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("not valid JSON");
    }
  });

  it("rejects plans with repeated section keys", () => {
    const repeated = JSON.stringify({
      mode: "player",
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "First.",
          ruleIds: [],
        },
        {
          key: "attributes",
          title: "Attributes again",
          purpose: "Second.",
          ruleIds: [],
        },
      ],
    });
    const parsed = parseSectionPlan(repeated);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const feedback = validateSectionPlanAgainstContext(
        parsed.plan,
        makeRulesContext(),
      );
      expect(feedback).toContain('"attributes" repeats');
    }
  });

  it("rejects an empty section list", () => {
    const parsed = parseSectionPlan(
      JSON.stringify({ mode: "player", sections: [] }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("rejects a degenerate one-character section title", () => {
    const bad = JSON.parse(VALID_PLAN_JSON) as {
      sections: Array<Record<string, unknown>>;
    };
    bad.sections[0]!.title = "A";
    const parsed = parseSectionPlan(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
  });
});

const VALID_FIELDS_JSON = JSON.stringify({
  fields: [
    {
      key: "name",
      label: "Name",
      type: "text",
      maxLength: 40,
      ruleIds: [RULE_ATTACK_ID],
    },
    {
      key: "level",
      label: "Level",
      type: "number",
      min: 1,
      max: 20,
      ruleIds: [RULE_HIT_POINTS_ID],
    },
    {
      key: "hp_current",
      label: "Current Hit Points",
      type: "number",
      min: 0,
      ruleIds: [],
    },
    {
      key: "hp_max",
      label: "Maximum Hit Points",
      type: "number",
      min: 1,
      ruleIds: [],
    },
    {
      key: "hp",
      label: "Hit Points Pool",
      type: "resource",
      references: { currentFieldKey: "hp_current", maxFieldKey: "hp_max" },
      ruleIds: [RULE_HIT_POINTS_ID],
    },
  ],
});

describe("parseFieldCandidates", () => {
  it("accepts structurally valid fields", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.fields.fields).toHaveLength(5);
    }
  });

  it("rejects resource fields that reference nothing", () => {
    const bad = JSON.parse(VALID_FIELDS_JSON) as Record<string, unknown>;
    (bad.fields as Array<Record<string, unknown>>)[4] = {
      key: "hp",
      label: "Hit Points Pool",
      type: "resource",
      references: {},
      ruleIds: [],
    };
    const parsed = parseFieldCandidates(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("references");
    }
  });

  it("rejects non-array or empty field lists", () => {
    expect(parseFieldCandidates(JSON.stringify({ fields: [] })).ok).toBe(false);
    expect(parseFieldCandidates('{"fields": {}}').ok).toBe(false);
  });

  it("rejects a degenerate one-character field label", () => {
    const bad = JSON.parse(VALID_FIELDS_JSON) as {
      fields: Array<Record<string, unknown>>;
    };
    bad.fields[0]!.label = "A";
    const parsed = parseFieldCandidates(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
  });
});

describe("parseCalculationCandidates", () => {
  const VALID = JSON.stringify({
    calculations: [
      {
        key: "hp_bonus",
        label: "Bonus Hit Points",
        expression: {
          op: "add",
          left: { op: "literal", value: 2 },
          right: { op: "field", fieldKey: "level" },
        },
        ruleIds: [RULE_HIT_POINTS_ID],
      },
    ],
  });

  it("accepts a bounded expression tree", () => {
    const parsed = parseCalculationCandidates(VALID);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.calculations.calculations[0]?.expression.op).toBe("add");
    }
  });

  it("rejects unbounded recursion beyond the depth cap", () => {
    const deep: { op: "literal"; value: number } = { op: "literal", value: 1 };
    let expression: unknown = deep;
    for (let index = 0; index < 20; index += 1) {
      expression = {
        op: "add",
        left: deep,
        right: expression,
      };
    }
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [{ key: "x", label: "Deep Value", expression }],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("rejects a self-referencing calculation", () => {
    const selfRef = JSON.stringify({
      calculations: [
        {
          key: "hp_bonus",
          label: "Bonus Hit Points",
          expression: { op: "field", fieldKey: "hp_bonus" },
          ruleIds: [],
        },
      ],
    });
    const parsed = parseCalculationCandidates(selfRef);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const invalid = validateCalculationCandidatesAgainstContext(
        parsed.calculations.calculations,
        [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            type: "calculated",
            sectionKey: "attributes",
            sectionOrder: 0,
          },
        ],
      );
      expect(invalid).toContain("references itself");
    }
  });
});

describe("validateSectionPlanAgainstContext", () => {
  it("rejects unknown rule ids in any section", () => {
    const parsed = parseSectionPlan(VALID_PLAN_JSON);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const plan = parsed.plan;
    plan.sections[0] = { ...plan.sections[0]!, ruleIds: ["ghost-rule"] };
    const invalid = validateSectionPlanAgainstContext(plan, makeRulesContext());
    expect(invalid).toContain("ghost-rule");
  });

  it("accepts a plan whose rules all exist", () => {
    const parsed = parseSectionPlan(VALID_PLAN_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid plan");
    }
    expect(
      validateSectionPlanAgainstContext(parsed.plan, makeRulesContext()),
    ).toBeNull();
  });
});

describe("validateFieldCandidatesAgainstContext", () => {
  it("accepts valid fields whose rules and references resolve", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const invalid = validateFieldCandidatesAgainstContext(
      parsed.fields.fields,
      makeRulesContext(),
      new Set(),
    );
    expect(invalid).toBeNull();
  });

  it("rejects a key already used by an earlier section", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const invalid = validateFieldCandidatesAgainstContext(
      parsed.fields.fields,
      makeRulesContext(),
      new Set(["name"]),
    );
    expect(invalid).toContain("name");
    expect(invalid).toContain("already used");
  });

  it("rejects unknown rule and field references", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const fields = parsed.fields.fields.map((field) =>
      field.key === "name" ? { ...field, ruleIds: ["ghost-rule"] } : field,
    );
    const invalid = validateFieldCandidatesAgainstContext(
      fields,
      makeRulesContext(),
      new Set(),
    );
    expect(invalid).toContain("ghost-rule");
  });

  it("rejects a resource field referencing an unknown target", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const fields = parsed.fields.fields.map((field) =>
      field.key === "hp"
        ? {
            ...field,
            references: {
              currentFieldKey: "missing_current",
              maxFieldKey: "hp_max",
            },
          }
        : field,
    );
    const invalid = validateFieldCandidatesAgainstContext(
      fields,
      makeRulesContext(),
      new Set(),
    );
    expect(invalid).toContain("missing_current");
  });

  it("rejects a resource field referencing a non-numeric target", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const fields = parsed.fields.fields.map((field) =>
      field.key === "hp"
        ? {
            ...field,
            references: {
              currentFieldKey: "name",
              maxFieldKey: "hp_max",
            },
          }
        : field,
    );
    const invalid = validateFieldCandidatesAgainstContext(
      fields,
      makeRulesContext(),
      new Set(),
    );
    expect(invalid).toContain("name");
    expect(invalid).toContain('"text" field');
  });

  it("rejects a resource referencing a non-numeric field from an earlier section", () => {
    const parsed = parseFieldCandidates(VALID_FIELDS_JSON);
    if (!parsed.ok) {
      throw new Error("expected valid fields");
    }
    const fields = parsed.fields.fields.filter((field) => field.key !== "hp");
    const invalid = validateFieldCandidatesAgainstContext(
      fields,
      makeRulesContext(),
      new Set(),
      new Map([
        ["name", "text" as const],
        ["level", "number" as const],
      ]),
    );
    expect(invalid).toBeNull();
    const resourceField = parsed.fields.fields.find(
      (field) => field.key === "hp",
    )!;
    const withBadRef = [
      ...fields,
      {
        ...resourceField,
        references: { currentFieldKey: "name", maxFieldKey: "hp_max" },
      },
    ];
    const invalidRef = validateFieldCandidatesAgainstContext(
      withBadRef,
      makeRulesContext(),
      new Set(),
      new Map([
        ["name", "text" as const],
        ["level", "number" as const],
      ]),
    );
    expect(invalidRef).toContain("name");
  });
});

describe("validateCalculationCandidatesAgainstContext", () => {
  const ATTRIBUTE_FIELD_INDEX = [
    {
      key: "level",
      label: "Level",
      type: "number" as const,
      sectionKey: "attributes",
      sectionOrder: 0,
    },
    {
      key: "hp_bonus",
      label: "Bonus Hit Points",
      type: "calculated" as const,
      sectionKey: "attributes",
      sectionOrder: 0,
    },
  ];

  const MULTI_SECTION_FIELD_INDEX = [
    ...ATTRIBUTE_FIELD_INDEX,
    {
      key: "initiative",
      label: "Initiative",
      type: "calculated" as const,
      sectionKey: "derived",
      sectionOrder: 1,
    },
    {
      key: "notes_length",
      label: "Notes Length",
      type: "number" as const,
      sectionKey: "notes",
      sectionOrder: 2,
    },
  ];

  it("accepts calculations that resolve every calculated field", () => {
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            expression: { op: "field", fieldKey: "level" },
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error("expected valid calculations");
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      ATTRIBUTE_FIELD_INDEX,
    );
    expect(invalid).toBeNull();
  });

  it("rejects calculations for unknown keys and missing calculated fields", () => {
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [
          {
            key: "mystery",
            label: "Mystery",
            expression: { op: "literal", value: 1 },
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error("expected valid calculations");
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      ATTRIBUTE_FIELD_INDEX,
    );
    expect(invalid).toContain("mystery");
    expect(invalid).toContain("hp_bonus");
  });

  it("rejects a reference to a field absent from the field index", () => {
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            expression: { op: "field", fieldKey: "ghost" },
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error("expected valid calculations");
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      ATTRIBUTE_FIELD_INDEX,
    );
    expect(invalid).toContain("ghost");
  });

  it("rejects a forward reference to a calculated field in a later section", () => {
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            expression: { op: "field", fieldKey: "initiative" },
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error("expected valid calculations");
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      MULTI_SECTION_FIELD_INDEX,
    );
    expect(invalid).toContain("order 0");
    expect(invalid).toContain("order 1");
    expect(invalid).toContain("attributes");
    expect(invalid).toContain("derived");
    expect(invalid).toContain("forward reference");
  });

  it("allows same/earlier calculated references and later non-calculated references", () => {
    const parsed = parseCalculationCandidates(
      JSON.stringify({
        calculations: [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            expression: { op: "literal", value: 0 },
            ruleIds: [],
          },
          {
            key: "initiative",
            label: "Initiative",
            expression: {
              op: "add",
              left: { op: "field", fieldKey: "hp_bonus" },
              right: { op: "field", fieldKey: "notes_length" },
            },
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error("expected valid calculations");
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      MULTI_SECTION_FIELD_INDEX,
    );
    expect(invalid).toBeNull();
  });
});
