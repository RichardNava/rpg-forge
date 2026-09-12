import { describe, expect, it } from "vitest";
import {
  computeModelMetrics,
  evaluateFixtureAcceptance,
  evaluateGeneratedLocale,
  resolveAttemptOutcomes,
} from "./metrics.js";
import type { FixtureRunResult } from "./harness.js";
import {
  getBenchmarkFixtureById,
  type SheetBenchmarkFixture,
} from "./fixtures.js";
import {
  meleeFixture,
  runOkMeleeWithBehavior,
  ScriptedMeleePort,
  ScriptedSheetPort,
} from "./test-helpers.js";
import { runFixtureThroughPipeline } from "./harness.js";

function casterFixture(): SheetBenchmarkFixture {
  const fixture = getBenchmarkFixtureById("en-arcane-caster");
  if (fixture === undefined) {
    throw new Error("fixture en-arcane-caster not found");
  }
  return fixture;
}

function withFixture<T>(
  base: SheetBenchmarkFixture,
  patch: Partial<SheetBenchmarkFixture>,
): SheetBenchmarkFixture {
  return { ...base, ...patch };
}

function castResult(result: FixtureRunResult): FixtureRunResult {
  return result as FixtureRunResult;
}

describe("sheet-benchmark acceptance evaluator", () => {
  it("passes a clean scripted run", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    expect(evaluateFixtureAcceptance(meleeFixture(), result).passed).toBe(true);
  });

  it("fails when any pipeline stage fails", async () => {
    const result = await runOkMeleeWithBehavior("throw-all");
    const acceptance = evaluateFixtureAcceptance(meleeFixture(), result);
    expect(acceptance.passed).toBe(false);
    expect(
      acceptance.checks.find(
        (check) => check.name === "all pipeline stages succeeded",
      )?.passed,
    ).toBe(false);
  });

  it("fails when an unknown rule id is fabricated into the plan", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const tampered = castResult({
      ...result,
      plan:
        result.plan === null
          ? null
          : {
              ...result.plan,
              sections: result.plan.sections.map((section, index) =>
                index === 0
                  ? { ...section, ruleIds: [...section.ruleIds, "rule-shadow"] }
                  : section,
              ),
            },
    });
    const acceptance = evaluateFixtureAcceptance(meleeFixture(), tampered);
    expect(acceptance.passed).toBe(false);
    const check = acceptance.checks.find(
      (item) => item.name === "no fabricated or unknown rule ids",
    );
    expect(check?.passed).toBe(false);
    expect(check?.details).toContain("rule-shadow");
  });

  it("fails when a required concept is missing", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const fixture = withFixture(meleeFixture(), {
      requiredConceptGroups: [
        ...meleeFixture().requiredConceptGroups,
        ["zzz-not-a-concept"],
      ],
    });
    const acceptance = evaluateFixtureAcceptance(fixture, result);
    expect(acceptance.passed).toBe(false);
    const check = acceptance.checks.find(
      (item) => item.name === "required concepts covered",
    );
    expect(check?.passed).toBe(false);
    expect(check?.details).toContain("zzz-not-a-concept");
  });

  it("fails when the calculated-field count does not match", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const fixture = withFixture(meleeFixture(), { expectedCalculatedCount: 0 });
    const acceptance = evaluateFixtureAcceptance(fixture, result);
    expect(acceptance.passed).toBe(false);
    const check = acceptance.checks.find(
      (item) => item.name === "expected calculated-field count",
    );
    expect(check?.passed).toBe(false);
  });

  it("fails when output contains an injected marker", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const raw =
      '{"mode":"player","sections":[{"title":"COMPROMISED://identity"}]}';
    const poisonedCall = {
      stage: "section-plan" as const,
      system: "system",
      user: "user",
      raw,
      responseLength: raw.length,
      slot: "section-plan",
      sectionKey: null,
      attemptNumber: 1,
      isCorrectionReplay: false,
      error: null,
      finishReason: null,
      usage: null,
      elapsedMs: 1,
    };
    const poisoned = castResult({
      ...result,
      calls: [...result.calls, poisonedCall],
    });
    const fixture = withFixture(meleeFixture(), {
      mustNotContain: [...meleeFixture().mustNotContain, "compromised://"],
    });
    const acceptance = evaluateFixtureAcceptance(fixture, poisoned);
    expect(acceptance.passed).toBe(false);
    const check = acceptance.checks.find(
      (item) => item.name === "no forbidden or injected terms in output",
    );
    expect(check?.passed).toBe(false);
    expect(check?.details).toContain("compromised");
  });
});

describe("sheet-benchmark metrics", () => {
  it("rolls up call counts and stage latency on a clean run", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const metrics = computeModelMetrics(
      "fixture-model",
      [result],
      [meleeFixture()],
    );

    expect(metrics.fixturesAttempted).toBe(1);
    expect(metrics.fixturesPassed).toBe(1);
    expect(metrics.passRate).toBe(1);
    expect(metrics.totalCalls).toBe(5);
    expect(metrics.nominalCalls).toBe(5); // 1 plan + 3 sections + 1 calc
    expect(metrics.retryCalls).toBe(0);
    expect(
      metrics.perStage.find((s) => s.stage === "section-plan")?.count,
    ).toBe(1);
    expect(
      metrics.perStage.find((s) => s.stage === "field-candidates")?.count,
    ).toBe(3);
    expect(
      metrics.perStage.find((s) => s.stage === "calculations")?.count,
    ).toBe(1);
    expect(metrics.totalElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("counts retry calls when the provider needs one correction", async () => {
    const result = await runOkMeleeWithBehavior("retry-plan");
    const metrics = computeModelMetrics(
      "fixture-model",
      [result],
      [meleeFixture()],
    );

    expect(metrics.totalCalls).toBe(6);
    expect(metrics.nominalCalls).toBe(5);
    expect(metrics.retryCalls).toBe(1);
  });

  it("includes failed fixtures in pass rate", async () => {
    const caster = casterFixture();
    const failed = await runFixtureThroughPipeline({
      fixture: caster,
      port: new ScriptedMeleePort("throw-all"),
    });
    const ok = await runOkMeleeWithBehavior("ok");
    const metrics = computeModelMetrics(
      "fixture-model",
      [ok, failed],
      [meleeFixture(), caster],
    );

    expect(metrics.fixturesAttempted).toBe(2);
    expect(metrics.fixturesPassed).toBe(1);
    expect(metrics.passRate).toBe(0.5);
    expect(metrics.totalCalls).toBe(6); // 5 ok + 1 failed attempt
  });
});

describe("sheet-benchmark locale evaluation", () => {
  function displayOnlyResult(input: {
    language: "en" | "es";
    planTitles: string[];
    labels: string[];
  }): FixtureRunResult {
    return castResult({
      fixtureId: "x",
      injection: false,
      role: "player",
      language: input.language,
      persona: null,
      stageResults: [],
      calls: [],
      run: null,
      spec: null,
      plan: {
        mode: "player",
        sections: input.planTitles.map((title, index) => ({
          key: `s${index}`,
          title,
          purpose: "p",
          ruleIds: [],
        })),
      },
      fieldsBySection: [
        {
          sectionKey: "s0",
          fields: input.labels.map((label) => ({
            key: `f${label}`,
            label,
            type: "number",
            ruleIds: [],
          })),
        },
      ],
      calculations: [],
    } as unknown as FixtureRunResult);
  }

  it("accepts English output for an en fixture", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const verdict = evaluateGeneratedLocale(result, "en");
    expect(verdict.verdict).toBe("satisfied");
    expect(verdict.detected).toBe("en");
  });

  it("accepts Spanish output for an es fixture", () => {
    const result = displayOnlyResult({
      language: "es",
      planTitles: ["Atributos", "Combate"],
      labels: ["Ataque", "Defensa"],
    });
    const verdict = evaluateGeneratedLocale(result, "es");
    expect(verdict.verdict).toBe("satisfied");
    expect(verdict.detected).toBe("es");
  });

  it("marks English output for an es fixture as wrong locale", () => {
    const result = displayOnlyResult({
      language: "es",
      planTitles: ["Attributes", "Combat"],
      labels: ["Attack"],
    });
    const verdict = evaluateGeneratedLocale(result, "es");
    expect(verdict.verdict).toBe("wrong_locale");
    expect(verdict.detected).toBe("en");
  });

  it("flags mixed-label output as mixed", () => {
    const result = displayOnlyResult({
      language: "en",
      planTitles: ["Ataque"],
      labels: ["Attack"],
    });
    const verdict = evaluateGeneratedLocale(result, "en");
    expect(verdict.verdict).toBe("mixed");
    expect(verdict.detected).toBeNull();
  });

  it("reports insufficient evidence instead of passing on too few text signals", () => {
    const result = displayOnlyResult({
      language: "en",
      planTitles: ["A", "B"],
      labels: ["X"],
    });
    const verdict = evaluateGeneratedLocale(result, "en");
    expect(verdict.verdict).toBe("insufficient");
    expect(verdict.detected).toBeNull();
  });
});

describe("sheet-benchmark attempt accounting", () => {
  it("resolves first attempts and correction success/failure per slot", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        fields: {
          attributes: ["invalid-json", "ok"],
          combat: ["schema-invalid", "schema-invalid"],
        },
      }),
    });
    expect(result.run?.status).toBe("FAILED");
    expect(result.run?.failureCode).toBe(
      "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID",
    );

    const outcomes = resolveAttemptOutcomes(result);
    expect(outcomes.firstAttempts).toBe(3); // plan + attributes + combat
    expect(outcomes.replays).toBe(2);
    expect(outcomes.successReplays).toBe(1); // attributes replay committed
    expect(outcomes.failedReplays).toBe(1); // combat replay failed

    const metrics = computeModelMetrics("fixture-model", [result], [fixture]);
    expect(metrics.firstAttempts).toBe(3);
    expect(metrics.correctionReplays).toBe(2);
    expect(metrics.correctionSuccesses).toBe(1);
    expect(metrics.correctionFailures).toBe(1);
    expect(metrics.nominalCalls).toBe(3);
    expect(metrics.retryCalls).toBe(2);
    expect(metrics.plannedCalls).toBe(5); // 1 plan + 3 sections + 1 calc

    const fieldsRollup = metrics.perStageAttempts.find(
      (s) => s.stage === "field-candidates",
    );
    expect(fieldsRollup?.firstAttempts).toBe(2);
    expect(fieldsRollup?.replays).toBe(2);
    expect(fieldsRollup?.successReplays).toBe(1);
    expect(fieldsRollup?.failedReplays).toBe(1);
    const planRollup = metrics.perStageAttempts.find(
      (s) => s.stage === "section-plan",
    );
    expect(planRollup?.firstAttempts).toBe(1);
    expect(planRollup?.replays).toBe(0);
  });

  it("keeps legacy rollups on a clean run", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const metrics = computeModelMetrics(
      "fixture-model",
      [result],
      [meleeFixture()],
    );
    expect(metrics.firstAttempts).toBe(5);
    expect(metrics.correctionReplays).toBe(0);
    expect(metrics.correctionSuccesses).toBe(0);
    expect(metrics.correctionFailures).toBe(0);
    expect(metrics.nominalCalls).toBe(5);
    expect(metrics.retryCalls).toBe(0);
    expect(metrics.plannedCalls).toBe(5);
    expect(metrics.totalCalls).toBe(5);
  });

  it("counts a single correction replay once", async () => {
    const result = await runOkMeleeWithBehavior("retry-plan");
    const metrics = computeModelMetrics(
      "fixture-model",
      [result],
      [meleeFixture()],
    );
    expect(metrics.totalCalls).toBe(6);
    expect(metrics.firstAttempts).toBe(5);
    expect(metrics.correctionReplays).toBe(1);
    expect(metrics.correctionSuccesses).toBe(1);
    expect(metrics.correctionFailures).toBe(0);
    expect(metrics.nominalCalls).toBe(5);
    expect(metrics.retryCalls).toBe(1);
    expect(metrics.plannedCalls).toBe(5);
  });
});

describe("sheet-benchmark failure taxonomy", () => {
  it("classifies a provider transport throw", async () => {
    const result = await runOkMeleeWithBehavior("throw-all");
    const report = evaluateFixtureAcceptance(meleeFixture(), result);
    expect(result.run?.status).toBe("FAILED");
    expect(report.taxonomy).toBe("provider_transport");
    const planStage = result.stageResults.find(
      (s) => s.stage === "section-plan",
    );
    expect(planStage?.diagnostic?.taxonomy).toBe("provider_transport");
    expect(planStage?.diagnostic?.errorName).toBe("Error");
  });

  it("classifies a permanent JSON parse failure", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        sectionPlan: ["invalid-json", "invalid-json"],
      }),
    });
    expect(result.run?.failureCode).toBe("CHARACTER_SHEET_PLAN_OUTPUT_INVALID");
    expect(evaluateFixtureAcceptance(fixture, result).taxonomy).toBe(
      "json_parse",
    );
  });

  it("classifies a permanent structured-output failure", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        sectionPlan: ["schema-invalid", "schema-invalid"],
      }),
    });
    expect(result.run?.failureCode).toBe("CHARACTER_SHEET_PLAN_OUTPUT_INVALID");
    expect(evaluateFixtureAcceptance(fixture, result).taxonomy).toBe(
      "structured_output",
    );
  });

  it("classifies a semantic validation failure", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        fields: { combat: ["validate-fail", "validate-fail"] },
      }),
    });
    expect(result.run?.failureCode).toBe(
      "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID",
    );
    expect(evaluateFixtureAcceptance(fixture, result).taxonomy).toBe(
      "semantic_validation",
    );
    const combat = result.stageResults.find((s) => s.stage === "fields:combat");
    expect(combat?.diagnostic?.detail).toContain(
      "already used by another section",
    );
  });

  it("classifies an acceptance coverage shortfall", async () => {
    const fixture = withFixture(meleeFixture(), {
      requiredConceptGroups: [
        ...meleeFixture().requiredConceptGroups,
        ["zzz-not-a-concept"],
      ],
    });
    const result = await runOkMeleeWithBehavior("ok");
    const report = evaluateFixtureAcceptance(fixture, result);
    expect(report.passed).toBe(false);
    expect(report.taxonomy).toBe("acceptance_coverage");
  });
});
