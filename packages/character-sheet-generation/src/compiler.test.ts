import { describe, expect, it } from "vitest";
import { validateCharacterSheetSpecDomain } from "@repo/character-sheet-schema";
import { compileCharacterSheet, SheetCompileError } from "./compiler.js";
import { parseFieldCandidates, parseSectionPlan } from "./generate.js";
import type { FieldCandidate, SectionPlanOutput } from "./intermediate.js";
import {
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
} from "./test/fakes.js";

const context = makeRulesContext();

function planWith(
  sections: Array<{
    key: string;
    title: string;
    purpose: string;
    ruleIds: string[];
  }>,
): SectionPlanOutput {
  const parsed = parseSectionPlan(JSON.stringify({ mode: "player", sections }));
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.plan;
}

const simplePlan = planWith([
  {
    key: "attributes",
    title: "Attributes",
    purpose: "Core attributes.",
    ruleIds: [RULE_ATTACK_ID, RULE_HIT_POINTS_ID],
  },
]);

const simpleFields = parseFieldCandidates(
  JSON.stringify({
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
        ruleIds: [],
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
  }),
);

function fieldsFor(sectionKey: string) {
  if (!simpleFields.ok) {
    throw new Error(simpleFields.error);
  }
  return simpleFields.fields.fields;
}

describe("compileCharacterSheet", () => {
  it("compiles a valid simple sheet into a canonical spec", () => {
    const spec = compileCharacterSheet({
      context,
      plan: simplePlan,
      fieldsBySection: new Map([["attributes", fieldsFor("attributes")]]),
      calculations: [],
    });
    expect(validateCharacterSheetSpecDomain(spec, context)).toEqual({
      valid: true,
      issues: [],
    });
    expect(spec.mode).toBe("player");
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.fieldIds).toEqual([
      "name",
      "level",
      "hp_current",
      "hp_max",
      "hp",
    ]);
    expect(spec.fields).toHaveLength(5);
    expect(spec.sourceMap["hp"]?.citations).toContainEqual(
      expect.objectContaining({ sourceId: context.sources[0]!.id }),
    );
  });

  it("rejects a section without generated fields", () => {
    expect(() =>
      compileCharacterSheet({
        context,
        plan: planWith([
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core.",
            ruleIds: [],
          },
          {
            key: "combat",
            title: "Combat",
            purpose: "Combat.",
            ruleIds: [],
          },
        ]),
        fieldsBySection: new Map([["attributes", fieldsFor("attributes")]]),
        calculations: [],
      }),
    ).toThrow(SheetCompileError);
  });

  it("rejects repeated field keys across sections with structured details", () => {
    const repeated: SectionPlanOutput = {
      mode: "player",
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "Core.",
          ruleIds: [],
        },
      ],
    };
    const fields = fieldsFor("attributes");
    const candidates = [...fields, ...fields];
    expect(() =>
      compileCharacterSheet({
        context,
        plan: repeated,
        fieldsBySection: new Map([["attributes", candidates]]),
        calculations: [],
      }),
    ).toThrow(/repeats across sections/);
  });

  it("compiles calculated fields with resolved formulas", () => {
    const parsed = parseFieldCandidates(
      JSON.stringify({
        fields: [
          {
            key: "level",
            label: "Level",
            type: "number",
            min: 1,
            max: 20,
            ruleIds: [],
          },
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            type: "calculated",
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const spec = compileCharacterSheet({
      context,
      plan: simplePlan,
      fieldsBySection: new Map([["attributes", parsed.fields.fields]]),
      calculations: [
        {
          key: "hp_bonus",
          label: "Bonus Hit Points",
          expression: { op: "field", fieldKey: "level" },
          ruleIds: [],
        },
      ],
    });
    const hpBonus = spec.fields.find((field) => field.id === "hp_bonus");
    expect(hpBonus?.type).toBe("calculated");
    if (hpBonus?.type === "calculated") {
      expect(hpBonus.formula).toEqual({ op: "field", fieldId: "level" });
    }
    expect(validateCharacterSheetSpecDomain(spec, context)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects a calculation key that does not match a calculated field", () => {
    const parsed = parseFieldCandidates(
      JSON.stringify({
        fields: [
          {
            key: "level",
            label: "Level",
            type: "number",
            min: 1,
            max: 20,
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(() =>
      compileCharacterSheet({
        context,
        plan: simplePlan,
        fieldsBySection: new Map([["attributes", parsed.fields.fields]]),
        calculations: [
          {
            key: "mystery",
            label: "Mystery",
            expression: { op: "literal", value: 1 },
            ruleIds: [],
          },
        ],
      }),
    ).toThrow(/does not match a calculated field/);
  });

  it("rejects formula cycles among calculated fields", () => {
    const parsed = parseFieldCandidates(
      JSON.stringify({
        fields: [
          { key: "a", label: "Alpha", type: "calculated", ruleIds: [] },
          { key: "b", label: "Beta", type: "calculated", ruleIds: [] },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(() =>
      compileCharacterSheet({
        context,
        plan: simplePlan,
        fieldsBySection: new Map([["attributes", parsed.fields.fields]]),
        calculations: [
          {
            key: "a",
            label: "Alpha",
            expression: { op: "field", fieldKey: "b" },
            ruleIds: [],
          },
          {
            key: "b",
            label: "Beta",
            expression: { op: "field", fieldKey: "a" },
            ruleIds: [],
          },
        ],
      }),
    ).toThrow(/cycle/);
  });

  it("rejects forward references to calculated fields in later sections", () => {
    const parsed = parseFieldCandidates(
      JSON.stringify({
        fields: [
          {
            key: "level",
            label: "Level",
            type: "number",
            min: 1,
            max: 20,
            ruleIds: [],
          },
          {
            key: "bonus_total",
            label: "Bonus Total",
            type: "calculated",
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const derived = parseFieldCandidates(
      JSON.stringify({
        fields: [
          {
            key: "initiative",
            label: "Initiative",
            type: "calculated",
            ruleIds: [],
          },
        ],
      }),
    );
    if (!derived.ok) {
      throw new Error(derived.error);
    }
    expect(() =>
      compileCharacterSheet({
        context,
        plan: planWith([
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core.",
            ruleIds: [],
          },
          {
            key: "derived",
            title: "Derived",
            purpose: "Calculated.",
            ruleIds: [],
          },
        ]),
        fieldsBySection: new Map([
          ["attributes", parsed.fields.fields],
          ["derived", derived.fields.fields],
        ]),
        calculations: [
          {
            key: "bonus_total",
            label: "Bonus Total",
            expression: { op: "field", fieldKey: "initiative" },
            ruleIds: [],
          },
        ],
      }),
    ).toThrow(/forward reference|later section/);
  });

  it("rejects references to unknown fields in calculations", () => {
    const parsed = parseFieldCandidates(
      JSON.stringify({
        fields: [
          {
            key: "level",
            label: "Level",
            type: "number",
            min: 1,
            max: 20,
            ruleIds: [],
          },
          {
            key: "level_total",
            label: "Level Total",
            type: "calculated",
            ruleIds: [],
          },
        ],
      }),
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(() =>
      compileCharacterSheet({
        context,
        plan: simplePlan,
        fieldsBySection: new Map([["attributes", parsed.fields.fields]]),
        calculations: [
          {
            key: "level_total",
            label: "Level Total",
            expression: {
              op: "add",
              left: { op: "field", fieldKey: "level" },
              right: { op: "field", fieldKey: "ghost" },
            },
            ruleIds: [],
          },
        ],
      }),
    ).toThrow(/unknown field/);
  });

  it("rejects sheets that exceed the total field bound", () => {
    const sections: Array<{
      key: string;
      title: string;
      purpose: string;
      ruleIds: string[];
    }> = [];
    const fieldsBySection = new Map<string, FieldCandidate[]>();
    for (let sectionIndex = 0; sectionIndex < 5; sectionIndex += 1) {
      const key = `section_${sectionIndex}`;
      sections.push({
        key,
        title: `Section ${sectionIndex}`,
        purpose: "Fields.",
        ruleIds: [],
      });
      fieldsBySection.set(
        key,
        Array.from({ length: 48 }, (_, fieldIndex) => ({
          key: `field_${sectionIndex}_${fieldIndex}`,
          label: `Field ${sectionIndex}.${fieldIndex}`,
          type: "text",
          ruleIds: [],
          requiredForPlayableNpc: false,
          breakBefore: false,
        })),
      );
    }
    expect(() =>
      compileCharacterSheet({
        context,
        plan: planWith(sections),
        fieldsBySection,
        calculations: [],
      }),
    ).toThrow(/at most/);
  });
});
