import { describe, expect, it } from "vitest";
import {
  beginSheetGenerationRun,
  compileSheetGeneration,
  generateSectionFields,
  generateSectionPlan,
  generateSheetCalculations,
  invalidateSheetGenerations,
  readSheetGenerationRun,
} from "./services.js";
import {
  clock,
  createHarness,
  makeReadyRulesRun,
  RULE_ATTACK_ID,
  RULE_HIT_POINTS_ID,
  sheetIdGenerator,
} from "./test/fakes.js";

const ANALYSIS_ID = "analysis-00000000-0000-4000-8000-000000000000";

const beginDeps = (harness: ReturnType<typeof createHarness>) => ({
  clock,
  idGenerator: sheetIdGenerator,
  runRepository: harness.runRepository,
  rulesAnalysisRunRepository: harness.rulesAnalysisRunRepository,
  rulesArtifactStore: harness.rulesArtifactStore,
  artifactStore: harness.artifactStore,
});

const stageDeps = (harness: ReturnType<typeof createHarness>) => ({
  clock,
  runRepository: harness.runRepository,
  artifactStore: harness.artifactStore,
  sheetGeneration: harness.sheetGeneration,
});

const readDeps = (harness: ReturnType<typeof createHarness>) => ({
  runRepository: harness.runRepository,
  artifactStore: harness.artifactStore,
});

const VALID_PLAN = JSON.stringify({
  mode: "player",
  sections: [
    {
      key: "attributes",
      title: "Attributes",
      purpose: "Core attributes.",
      ruleIds: [RULE_ATTACK_ID],
    },
  ],
});

const VALID_FIELDS = JSON.stringify({
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
});

async function begin(harness: ReturnType<typeof createHarness>) {
  const result = await beginSheetGenerationRun(
    { analysisId: ANALYSIS_ID },
    beginDeps(harness),
  );
  if (result.kind !== "started") {
    throw new Error(`expected started, got ${result.kind}`);
  }
  return result.run;
}

describe("beginSheetGenerationRun", () => {
  it("starts a QUEUED generation from a ready rules context", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    expect(run.status).toBe("QUEUED");
    expect(run.isCurrent).toBe(true);
    expect(run.analysisId).toBe(ANALYSIS_ID);
    expect(run.ingestionId).toBe(makeReadyRulesRun().ingestionId);
    expect(run.rulesAnalysisRunId).toBe(makeReadyRulesRun().runId);
    expect(harness.artifactStore.inputs.size).toBe(1);
  });

  it("reports run_already_exists while an active generation exists", async () => {
    const harness = createHarness();
    await begin(harness);
    const result = await beginSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      beginDeps(harness),
    );
    expect(result.kind).toBe("run_already_exists");
  });

  it("returns rules_context_not_ready when the analysis has no rules run", async () => {
    const harness = createHarness();
    harness.rulesAnalysisRunRepository.current = null;
    const result = await beginSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      beginDeps(harness),
    );
    expect(result.kind).toBe("rules_context_not_ready");
  });

  it("returns storage_unavailable without creating a run when R2 is down", async () => {
    const harness = createHarness();
    harness.artifactStore.failureCodes.push("putInput");
    const result = await beginSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      beginDeps(harness),
    );
    expect(result.kind).toBe("storage_unavailable");
    expect(harness.runRepository.currentByAnalysis.size).toBe(0);
  });
});

describe("generateSectionPlan", () => {
  it("claims the run, generates a valid plan, and persists it", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN]);
    const result = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.sections).toHaveLength(1);
    }
    expect(harness.sheetGeneration.calls).toHaveLength(1);
    expect(harness.runRepository.runs.get(run.runId)?.status).toBe(
      "GENERATING",
    );
    expect(harness.artifactStore.sectionPlans.size).toBe(1);
  });

  it("retries once when the first output fails validation", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script(["not json", VALID_PLAN]);
    const result = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    expect(harness.sheetGeneration.calls).toHaveLength(2);
  });

  it("fails the run after exhausting retries", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script(["not json", "also not json"]);
    const result = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe("CHARACTER_SHEET_PLAN_OUTPUT_INVALID");
    }
    expect(harness.runRepository.runs.get(run.runId)?.status).toBe("FAILED");
  });

  it("fails the run when the model is unavailable", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.failures.push("model timeout");
    const result = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe("CHARACTER_SHEET_MODEL_UNAVAILABLE");
    }
  });

  it("skips generation for a stale non-current run", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN]);
    const first = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(first.kind).toBe("ok");

    harness.runRepository.runs.set(run.runId, { ...run, isCurrent: false });
    harness.sheetGeneration.script([VALID_PLAN]);
    const result = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("skipped");
    expect(harness.sheetGeneration.calls).toHaveLength(1);
    expect(harness.artifactStore.sectionPlans.size).toBe(1);
  });
});

describe("generateSectionFields", () => {
  it("generates and persists fields for a plan section", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN, VALID_FIELDS]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(plan.kind).toBe("ok");
    const result = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.fields).toHaveLength(5);
    }
    expect(harness.artifactStore.sectionFields.size).toBe(1);
  });

  it("returns skipped for an unknown section key", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN]);
    await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    harness.sheetGeneration.script([VALID_FIELDS]);
    const result = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "ghost" },
      stageDeps(harness),
    );
    expect(result.kind).toBe("skipped");
    expect(harness.sheetGeneration.calls).toHaveLength(1);
  });

  it("fails the run when R2 cannot serve the section plan", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN]);
    await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    harness.artifactStore.failureCodes.push("getSectionPlan");
    const result = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe("CHARACTER_SHEET_STORAGE_UNAVAILABLE");
    }
  });

  it("fails the run when field output stays invalid", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN, "bad", "also bad"]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(plan.kind).toBe("ok");
    const result = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe("CHARACTER_SHEET_FIELDS_OUTPUT_INVALID");
    }
  });
});

describe("generateSheetCalculations", () => {
  async function twoSections(harness: ReturnType<typeof createHarness>) {
    const run = await begin(harness);
    harness.sheetGeneration.script([
      JSON.stringify({
        mode: "player",
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core attributes.",
            ruleIds: [RULE_ATTACK_ID],
          },
          {
            key: "combat",
            title: "Combat",
            purpose: "Combat traits.",
            ruleIds: [RULE_HIT_POINTS_ID],
          },
        ],
      }),
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
      JSON.stringify({
        fields: [
          {
            key: "attack",
            label: "Attack",
            type: "text",
            maxLength: 40,
            ruleIds: [RULE_ATTACK_ID],
          },
        ],
      }),
    ]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error(`expected ok plan, got ${plan.kind}`);
    }
    const attributes = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (attributes.kind !== "ok") {
      throw new Error(`expected ok attributes, got ${attributes.kind}`);
    }
    const combat = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "combat" },
      stageDeps(harness),
    );
    if (combat.kind !== "ok") {
      throw new Error(`expected ok combat, got ${combat.kind}`);
    }
    return run;
  }

  it("short-circuits empty calculations when nothing is calculated", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN, VALID_FIELDS]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error("expected ok plan");
    }
    const fields = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (fields.kind !== "ok") {
      throw new Error("expected ok fields");
    }
    const callsBefore = harness.sheetGeneration.calls.length;
    const result = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value).toEqual([]);
    }
    expect(harness.sheetGeneration.calls.length).toBe(callsBefore);
    expect(harness.artifactStore.calculations.size).toBe(1);
  });

  it("persists calculation candidates that resolve every calculated field", async () => {
    const harness = createHarness();
    const run = await twoSections(harness);
    harness.sheetGeneration.script([
      JSON.stringify({
        calculations: [
          {
            key: "hp_bonus",
            label: "Bonus Hit Points",
            expression: { op: "field", fieldKey: "level" },
            ruleIds: [RULE_HIT_POINTS_ID],
          },
        ],
      }),
    ]);
    const result = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value).toHaveLength(1);
    }
    expect(harness.artifactStore.calculations.size).toBe(1);
  });

  it("fails the run when a calculated field stays unresolved", async () => {
    const harness = createHarness();
    const run = await twoSections(harness);
    harness.sheetGeneration.script([
      JSON.stringify({ calculations: [] }),
      JSON.stringify({ calculations: [] }),
    ]);
    const result = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe(
        "CHARACTER_SHEET_CALCULATIONS_OUTPUT_INVALID",
      );
    }
  });
});

describe("compileSheetGeneration", () => {
  async function fullPipeline(harness: ReturnType<typeof createHarness>) {
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN, VALID_FIELDS]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error("expected ok plan");
    }
    const fields = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (fields.kind !== "ok") {
      throw new Error("expected ok fields");
    }
    const calcs = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (calcs.kind !== "ok") {
      throw new Error("expected ok calculations");
    }
    return run;
  }

  it("compiles a full pipeline into a READY run with a persisted spec", async () => {
    const harness = createHarness();
    const run = await fullPipeline(harness);
    const result = await compileSheetGeneration(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.sections).toHaveLength(1);
    }
    expect(harness.runRepository.runs.get(run.runId)?.status).toBe("READY");
    expect(harness.artifactStore.specs.size).toBe(1);
  });

  it("compiles calculated fields into resolved formulas", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([
      VALID_PLAN,
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
    ]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error("expected ok plan");
    }
    const fields = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (fields.kind !== "ok") {
      throw new Error("expected ok fields");
    }
    const calcs = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (calcs.kind !== "ok") {
      throw new Error("expected ok calculations");
    }
    const result = await compileSheetGeneration(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const hpBonus = result.value.fields.find(
        (field) => field.id === "hp_bonus",
      );
      expect(hpBonus?.type).toBe("calculated");
    }
  });

  it("skips compilation for a stale non-current run", async () => {
    const harness = createHarness();
    const run = await fullPipeline(harness);
    harness.runRepository.runs.set(run.runId, { ...run, isCurrent: false });
    const result = await compileSheetGeneration(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("skipped");
  });

  it("fails the run when domain validation rejects the compiled spec", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([
      VALID_PLAN,
      JSON.stringify({
        fields: [
          {
            key: "inventory",
            label: "Inventory",
            type: "table",
            columns: [
              { id: "item", label: "Item", valueType: "text" },
              { id: "item", label: "Item quantity", valueType: "number" },
            ],
            ruleIds: [],
          },
        ],
      }),
    ]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error("expected ok plan");
    }
    const fields = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (fields.kind !== "ok") {
      throw new Error(`expected ok fields, got ${fields.kind}`);
    }
    const calcs = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (calcs.kind !== "ok") {
      throw new Error("expected ok calculations");
    }
    const result = await compileSheetGeneration(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failureCode).toBe("CHARACTER_SHEET_DOMAIN_INVALID");
    }
    expect(harness.runRepository.runs.get(run.runId)?.status).toBe("FAILED");
  });
});

describe("readSheetGenerationRun", () => {
  it("reports run_not_found when no current generation exists", async () => {
    const harness = createHarness();
    const result = await readSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      readDeps(harness),
    );
    expect(result.kind).toBe("run_not_found");
  });

  it("returns the run with a null spec while not READY", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    const result = await readSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      readDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.run.runId).toBe(run.runId);
      expect(result.spec).toBeNull();
    }
  });

  it("returns the compiled spec once READY", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    harness.sheetGeneration.script([VALID_PLAN, VALID_FIELDS]);
    const plan = await generateSectionPlan(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (plan.kind !== "ok") {
      throw new Error("expected ok plan");
    }
    const fields = await generateSectionFields(
      { analysisId: ANALYSIS_ID, runId: run.runId, sectionKey: "attributes" },
      stageDeps(harness),
    );
    if (fields.kind !== "ok") {
      throw new Error("expected ok fields");
    }
    const calcs = await generateSheetCalculations(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (calcs.kind !== "ok") {
      throw new Error("expected ok calculations");
    }
    const compiled = await compileSheetGeneration(
      { analysisId: ANALYSIS_ID, runId: run.runId },
      stageDeps(harness),
    );
    if (compiled.kind !== "ok") {
      throw new Error("expected ok compile");
    }
    const result = await readSheetGenerationRun(
      { analysisId: ANALYSIS_ID },
      readDeps(harness),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.run.status).toBe("READY");
      expect(result.spec).not.toBeNull();
      expect(result.spec?.sections).toHaveLength(1);
    }
  });
});

describe("invalidateSheetGenerations", () => {
  it("invalidates non-terminal runs and deletes their artifacts", async () => {
    const harness = createHarness();
    const run = await begin(harness);
    const result = await invalidateSheetGenerations(
      { analysisId: ANALYSIS_ID },
      readDeps(harness),
    );
    expect(result.invalidated).toBe(1);
    const current = await harness.runRepository.findRun(ANALYSIS_ID, run.runId);
    expect(current?.status).toBe("INVALIDATED");
    expect(current?.isCurrent).toBe(false);
    expect(harness.artifactStore.deleted).toBe(1);
  });
});
