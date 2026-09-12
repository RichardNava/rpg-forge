import { describe, expect, it } from "vitest";

import {
  RulesContextSchema,
  validateRulesContextDomain,
} from "@repo/rules-context";
import { SheetGenerationInputArtifactSchema } from "@repo/character-sheet-generation";
import {
  FIXED_NOW,
  getBenchmarkFixtureById,
  INGESTION_ID,
  RULES_ANALYSIS_RUN_ID,
  SHEET_BENCHMARK_FIXTURES,
  SHEET_RUN_ID,
} from "./fixtures.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("sheet-benchmark fixtures", () => {
  it("uses unique fixture ids", () => {
    const ids = SHEET_BENCHMARK_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defines an expected calculated-field count within bounds", () => {
    for (const fixture of SHEET_BENCHMARK_FIXTURES) {
      expect(fixture.expectedCalculatedCount).toBeGreaterThanOrEqual(0);
      expect(fixture.expectedCalculatedCount).toBeLessThanOrEqual(32);
    }
  });

  it("every context parses and is domain-valid", () => {
    for (const fixture of SHEET_BENCHMARK_FIXTURES) {
      const parsed = RulesContextSchema.safeParse(fixture.context);
      expect(
        parsed.success,
        `${fixture.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
      const domain = validateRulesContextDomain(fixture.context);
      expect(
        domain.valid,
        `${fixture.id}: ${JSON.stringify(domain.issues)}`,
      ).toBe(true);
    }
  });

  it("uses a uuid analysis id and feeds a valid input artifact", () => {
    for (const fixture of SHEET_BENCHMARK_FIXTURES) {
      expect(UUID_PATTERN.test(fixture.context.analysisId)).toBe(true);
      const artifact = SheetGenerationInputArtifactSchema.safeParse({
        version: 1,
        runId: SHEET_RUN_ID,
        analysisId: fixture.context.analysisId,
        rulesAnalysisRunId: RULES_ANALYSIS_RUN_ID,
        ingestionId: INGESTION_ID,
        context: fixture.context,
      });
      expect(
        artifact.success,
        `${fixture.id}: ${artifact.success ? "" : JSON.stringify(artifact.error.issues)}`,
      ).toBe(true);
    }
  });

  it("covers both roles and languages and one injection fixture", () => {
    expect(
      new Set(SHEET_BENCHMARK_FIXTURES.map((fixture) => fixture.role)),
    ).toEqual(new Set(["player", "npc"]));
    expect(
      new Set(SHEET_BENCHMARK_FIXTURES.map((fixture) => fixture.language)),
    ).toEqual(new Set(["en", "es"]));
    expect(
      SHEET_BENCHMARK_FIXTURES.filter((fixture) => fixture.injection),
    ).toHaveLength(1);
  });

  it("the injection fixture carries real adversarial content in its rules", () => {
    const injection = SHEET_BENCHMARK_FIXTURES.find(
      (fixture) => fixture.injection,
    );
    expect(injection).toBeDefined();
    const marker = injection?.context.normalizedRules.find(
      (rule) => rule.id === "rule-malfunction-marker",
    );
    expect(marker).toBeDefined();
    expect(marker?.summary).toContain("COMPROMISED://");
    expect(marker?.summary).toContain("<script>");
    expect(injection?.mustNotContain).toContain("compromised://");
  });

  it("every required rule id exists in its fixture context", () => {
    for (const fixture of SHEET_BENCHMARK_FIXTURES) {
      const known = new Set(fixture.context.normalizedRules.map((r) => r.id));
      for (const ruleId of fixture.requiredRuleIds) {
        expect(known.has(ruleId), `${fixture.id}: unknown ${ruleId}`).toBe(
          true,
        );
      }
    }
  });

  it("looks up fixtures by id", () => {
    const fixture = SHEET_BENCHMARK_FIXTURES[0]!;
    expect(getBenchmarkFixtureById(fixture.id)).toBe(fixture);
    expect(getBenchmarkFixtureById("does-not-exist")).toBeUndefined();
  });

  it("exports the fixed temporal contract", () => {
    expect(FIXED_NOW.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    for (const id of [SHEET_RUN_ID, RULES_ANALYSIS_RUN_ID, INGESTION_ID]) {
      expect(UUID_PATTERN.test(id)).toBe(true);
    }
  });
});
