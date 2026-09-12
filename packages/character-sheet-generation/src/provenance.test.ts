import { describe, expect, it } from "vitest";
import { buildFieldProvenance, allRuleIds } from "./provenance.js";
import {
  makeRulesContext,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
  SOURCE_ID,
} from "./test/fakes.js";
import { MAX_REFERENCED_RULES_PER_FIELD } from "./model.js";

describe("buildFieldProvenance", () => {
  it("normalizes known rule ids in caller order and unions genuine citations", () => {
    const context = makeRulesContext();
    const provenance = buildFieldProvenance(
      [RULE_HIT_POINTS_ID, RULE_ATTACK_ID],
      context,
    );
    expect(provenance.ruleIds).toEqual([RULE_HIT_POINTS_ID, RULE_ATTACK_ID]);
    expect(provenance.citations).toHaveLength(2);
    expect(provenance.citations?.[0]?.sourceId).toBe(SOURCE_ID);
  });

  it("drops unknown rule ids and empty rule lists produce a structual failure", () => {
    const context = makeRulesContext();
    const provenance = buildFieldProvenance(
      [RULE_ATTACK_ID, "ghost-rule", RULE_HIT_POINTS_ID],
      context,
    );
    expect(provenance.ruleIds).toEqual([RULE_ATTACK_ID, RULE_HIT_POINTS_ID]);
  });

  it("throws when no rule id resolves to a known normalized rule", () => {
    const context = makeRulesContext();
    expect(() => buildFieldProvenance(["ghost-rule"], context)).toThrow(
      /at least one known rule id/,
    );
  });

  it("dedupes citations shared by multiple rules", () => {
    const context = makeRulesContext();
    const provenance = buildFieldProvenance(
      [RULE_ATTACK_ID, RULE_ATTACK_ID],
      context,
    );
    expect(provenance.citations).toHaveLength(1);
  });

  it("caps rule ids at the per-field bound", () => {
    const context = makeRulesContext();
    const ids = Array.from(
      { length: MAX_REFERENCED_RULES_PER_FIELD + 5 },
      (_, index) => (index % 2 === 0 ? RULE_ATTACK_ID : RULE_HIT_POINTS_ID),
    );
    const provenance = buildFieldProvenance(ids, context);
    expect(provenance.ruleIds.length).toBeLessThanOrEqual(
      MAX_REFERENCED_RULES_PER_FIELD,
    );
    expect(new Set(provenance.ruleIds).size).toBe(provenance.ruleIds.length);
  });
});

describe("allRuleIds", () => {
  it("exposes the canonical rule id set", () => {
    const ids = allRuleIds(makeRulesContext());
    expect(ids).toEqual(new Set([RULE_ATTACK_ID, RULE_HIT_POINTS_ID]));
  });
});
