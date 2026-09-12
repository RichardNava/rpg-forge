import { describe, expect, it } from "vitest";

import { evaluateFixtureAcceptance } from "./metrics.js";
import { runFixtureThroughPipeline, type FixtureRunResult } from "./harness.js";
import {
  getBenchmarkFixtureById,
  SHEET_BENCHMARK_FIXTURES,
  type SheetBenchmarkFixture,
} from "./fixtures.js";
import {
  meleeFixture,
  runOkMeleeWithBehavior,
  ScriptedMeleePort,
  ScriptedSheetPort,
} from "./test-helpers.js";
import { validateCharacterSheetSpecDomain } from "@repo/character-sheet-schema";

describe("sheet-benchmark harness pipeline", () => {
  it("runs the full production pipeline to a READY domain-valid sheet", async () => {
    const result = await runOkMeleeWithBehavior("ok");

    for (const stage of result.stageResults) {
      expect(stage.kind).toBe("ok");
    }
    expect(result.stageResults).toHaveLength(6); // plan + 3 sections + calc + compile
    expect(result.run?.status).toBe("READY");
    expect(result.run?.failureCode).toBeNull();
    expect(result.spec).not.toBeNull();
    expect(result.plan?.sections).toHaveLength(3);
    expect(result.calls).toHaveLength(5); // 1 plan + 3 field + 1 calc
    expect(
      validateCharacterSheetSpecDomain(result.spec!, meleeFixture().context)
        .valid,
    ).toBe(true);
  });

  it("passes the binary acceptance gate on the scripted run", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    const acceptance = evaluateFixtureAcceptance(meleeFixture(), result);
    expect(acceptance.passed).toBe(true);
  });

  it("fails with CHARACTER_SHEET_MODEL_UNAVAILABLE when the provider throws", async () => {
    const result = await runOkMeleeWithBehavior("throw-all");

    const planStage = result.stageResults.find(
      (stage) => stage.stage === "section-plan",
    );
    expect(planStage?.kind).toBe("failed");
    expect(planStage?.failureCode).toBe("CHARACTER_SHEET_MODEL_UNAVAILABLE");
    expect(result.run?.status).toBe("FAILED");
    expect(result.run?.failureCode).toBe("CHARACTER_SHEET_MODEL_UNAVAILABLE");
    expect(result.calls).toHaveLength(1);
    expect(result.spec).toBeNull();
  });

  it("uses the single correction replay inside the stage loop", async () => {
    const result = await runOkMeleeWithBehavior("retry-plan");

    const planCalls = result.calls.filter(
      (call) => call.stage === "section-plan",
    );
    expect(planCalls).toHaveLength(2); // invalid attempt + corrected replay
    const firstUser = planCalls[0]?.user ?? "";
    const secondUser = planCalls[1]?.user ?? "";
    expect(secondUser).not.toBe(firstUser);
    expect(secondUser).toContain("Validation feedback");
    const planStage = result.stageResults.find(
      (stage) => stage.stage === "section-plan",
    );
    expect(planStage?.kind).toBe("ok");
    expect(result.run?.status).toBe("READY");
  });

  it("produces an independent result per fixture", async () => {
    const results: FixtureRunResult[] = [];
    for (const fixture of SHEET_BENCHMARK_FIXTURES.slice(0, 2)) {
      const result = await runFixtureThroughPipeline({
        fixture,
        port: new ScriptedMeleePort("throw-all"),
      });
      results.push(result);
    }
    expect(results).toHaveLength(2);
    expect(results[0]?.fixtureId).toBe(SHEET_BENCHMARK_FIXTURES[0]?.id);
    expect(results[1]?.fixtureId).toBe(SHEET_BENCHMARK_FIXTURES[1]?.id);
    expect(results.every((result) => result.run?.status === "FAILED")).toBe(
      true,
    );
  });

  it("outputs the right intermediate artifacts for post-run inspection", async () => {
    const result = await runOkMeleeWithBehavior("ok");

    const keys = result.fieldsBySection.map((entry) => entry.sectionKey);
    expect(keys).toEqual(["attributes", "combat", "derived"]);
    const calculated = result.fieldsBySection
      .flatMap((entry) => entry.fields)
      .filter((field) => field.type === "calculated");
    expect(calculated).toHaveLength(1);
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]?.key).toBe("initiative");
  });

  it("always records raw provider text and system/user channels", async () => {
    const result = await runOkMeleeWithBehavior("ok");
    expect(result.calls.length).toBeGreaterThan(0);
    for (const call of result.calls) {
      expect(call.raw.length).toBeGreaterThan(0);
      expect(call.system.length).toBeGreaterThan(0);
      expect(call.user.length).toBeGreaterThan(0);
      expect(call.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("records explicit attempt metadata on every call", async () => {
    const result = await runOkMeleeWithBehavior("retry-plan");

    const planCalls = result.calls.filter(
      (call) => call.stage === "section-plan",
    );
    expect(planCalls).toHaveLength(2);
    expect(planCalls[0]?.attemptNumber).toBe(1);
    expect(planCalls[0]?.isCorrectionReplay).toBe(false);
    expect(planCalls[0]?.slot).toBe("section-plan");
    expect(planCalls[0]?.sectionKey).toBeNull();
    expect(planCalls[1]?.attemptNumber).toBe(2);
    expect(planCalls[1]?.isCorrectionReplay).toBe(true);

    for (const call of result.calls) {
      if (call.stage === "field-candidates") {
        expect(call.sectionKey).toBeTruthy();
        expect(call.slot).toBe(`field-candidates:${call.sectionKey}`);
      } else {
        expect(call.sectionKey).toBeNull();
        expect(call.slot).toBe(call.stage);
      }
      expect(call.responseLength).toBe(call.raw.length);
      expect(call.error).toBeNull();
    }
  });

  it("rejects a resource field targeting a non-numeric field at the semantic stage", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        customFields: {
          attributes: [
            {
              key: "dexterity",
              label: "Dexterity",
              type: "number",
              ruleIds: ["rule-dexterity"],
            },
            {
              key: "name",
              label: "Name",
              type: "text",
              ruleIds: [],
            },
            {
              key: "hp",
              label: "Hit Points",
              type: "resource",
              references: { currentFieldKey: "name", maxFieldKey: "dexterity" },
              ruleIds: ["rule-hit-points"],
            },
          ],
        },
      }),
    });
    expect(result.run?.status).toBe("FAILED");
    expect(result.run?.failureCode).toBe(
      "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID",
    );
    const fieldsStage = result.stageResults.find(
      (stage) => stage.stage === "fields:attributes",
    );
    expect(fieldsStage?.kind).toBe("failed");
    expect(fieldsStage?.diagnostic?.taxonomy).toBe("semantic_validation");
    expect(fieldsStage?.diagnostic?.detail).toContain("name");
    expect(fieldsStage?.diagnostic?.detail).toContain('"text" field');
  });

  it("rejects a forward calculation reference at the semantic stage", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        customFields: {
          attributes: [
            {
              key: "dexterity",
              label: "Dexterity",
              type: "number",
              ruleIds: ["rule-dexterity"],
            },
            {
              key: "dexterity_bonus",
              label: "Dexterity Bonus",
              type: "calculated",
              ruleIds: ["rule-dexterity"],
            },
          ],
        },
        customCalculations: [
          {
            key: "initiative",
            label: "Initiative",
            ruleIds: ["rule-dexterity"],
            expression: { op: "literal", value: 0 },
          },
          {
            key: "dexterity_bonus",
            label: "Dexterity Bonus",
            ruleIds: ["rule-dexterity"],
            expression: { op: "field", fieldKey: "initiative" },
          },
        ],
      }),
    });
    expect(result.run?.status).toBe("FAILED");
    expect(result.run?.failureCode).toBe(
      "CHARACTER_SHEET_CALCULATIONS_OUTPUT_INVALID",
    );
    const calcStage = result.stageResults.find(
      (stage) => stage.stage === "calculations",
    );
    expect(calcStage?.kind).toBe("failed");
    expect(calcStage?.diagnostic?.taxonomy).toBe("semantic_validation");
    expect(calcStage?.diagnostic?.detail).toContain("forward reference");
    expect(calcStage?.diagnostic?.detail).toContain("attributes");
    expect(calcStage?.diagnostic?.detail).toContain("derived");
  });

  it("reproduces a formula-cycle compiler fault with details", async () => {
    const fixture = meleeFixture();
    const result = await runFixtureThroughPipeline({
      fixture,
      port: new ScriptedSheetPort({
        customFields: {
          derived: [
            {
              key: "initiative",
              label: "Initiative",
              type: "calculated",
              ruleIds: ["rule-initiative"],
            },
            {
              key: "total",
              label: "Total",
              type: "calculated",
              ruleIds: ["rule-initiative"],
            },
          ],
        },
        customCalculations: [
          {
            key: "initiative",
            label: "Initiative",
            ruleIds: ["rule-initiative"],
            expression: { op: "field", fieldKey: "total" },
          },
          {
            key: "total",
            label: "Total",
            ruleIds: ["rule-initiative"],
            expression: { op: "field", fieldKey: "initiative" },
          },
        ],
      }),
    });
    expect(result.run?.status).toBe("FAILED");
    expect(result.run?.failureCode).toBe("CHARACTER_SHEET_DOMAIN_INVALID");
    expect(result.compileDiagnostics?.taxonomy).toBe("compiler");
    expect(result.compileDiagnostics?.compilerError).toContain("formula cycle");
    const compileStage = result.stageResults.find(
      (stage) => stage.stage === "compile",
    );
    expect(compileStage?.diagnostic?.taxonomy).toBe("compiler");
  });

  it("accepts the fixture helper and rejects unknown ids", () => {
    expect(getBenchmarkFixtureById("en-core-melee-fighter")).toBeDefined();
    expect(getBenchmarkFixtureById("nope")).toBeUndefined();
  });
});
