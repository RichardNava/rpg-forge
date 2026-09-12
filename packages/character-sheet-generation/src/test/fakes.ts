import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import type {
  RunArtifactPort,
  RulesAnalysisRun,
  RulesAnalysisRunRepositoryPort,
} from "@repo/rules-analysis-run";
import type { RulesContext } from "@repo/rules-context";
import type {
  InstructionExtractionPort,
  RulebookFieldDerivationPort,
  SheetArtifactPort,
  SheetGenerationPort,
} from "../ports.js";
import type {
  SheetRunClaimResult,
  SheetRunCreationResult,
  SheetGenerationRunRepositoryPort,
} from "../repository.js";
import type {
  SheetGenerationFailureCode,
  SheetGenerationRun,
} from "../model.js";
import type {
  CalculationCandidate,
  FieldCandidate,
  SectionPlanOutput,
} from "../intermediate.js";

export const FIXED_NOW = new Date("2026-09-08T12:00:00.000Z");
export const clock = { now: () => FIXED_NOW };

export const SOURCE_ID = "preset-rules";
export const RULE_ATTACK_ID = "rule-attack";
export const RULE_HIT_POINTS_ID = "rule-hit-points";

export function makeRulesContext(
  overrides: Partial<RulesContext> = {},
): RulesContext {
  const context: RulesContext = {
    schemaVersion: "1",
    analysisId: "analysis-00000000-0000-4000-8000-000000000000",
    sources: [
      {
        id: SOURCE_ID,
        type: "preset",
        systemKey: "generic",
        editionKey: "core",
        displayName: "Core Rules",
      },
    ],
    authorityOrder: [SOURCE_ID],
    characterIntent: { summary: "Create a veteran wilderness explorer." },
    ruleOverrides: [],
    normalizedRules: [
      {
        id: RULE_ATTACK_ID,
        category: "combat",
        key: "attack-roll",
        summary: "Attack rolls are resolved against a target threshold.",
        citations: [
          {
            sourceId: SOURCE_ID,
            pageStart: 42,
            pageEnd: 42,
            section: "Combat",
            chunkId: "chunk-combat-1",
          },
        ],
        confidence: 0.9,
      },
      {
        id: RULE_HIT_POINTS_ID,
        category: "combat",
        key: "hit-points",
        summary: "A character starts with hit points equal to a base pool.",
        citations: [
          {
            sourceId: SOURCE_ID,
            pageStart: 60,
            pageEnd: 61,
            section: "Hit Points",
            chunkId: null,
          },
        ],
        confidence: 0.85,
      },
    ],
    conflicts: [],
    status: "ready",
    ...overrides,
  };
  return context;
}

export interface SheetHarness {
  runRepository: FakeSheetRunRepository;
  artifactStore: FakeSheetArtifactStore;
  sheetGeneration: FakeSheetGenerationPort;
  rulesAnalysisRunRepository: FakeRulesAnalysisRunRepository;
  rulesArtifactStore: FakeRulesArtifactStore;
}

export function createHarness(
  overrides: Partial<SheetHarness> = {},
): SheetHarness {
  const harness: SheetHarness = {
    runRepository: new FakeSheetRunRepository(),
    artifactStore: new FakeSheetArtifactStore(),
    sheetGeneration: new FakeSheetGenerationPort(),
    rulesAnalysisRunRepository: new FakeRulesAnalysisRunRepository(),
    rulesArtifactStore: new FakeRulesArtifactStore(),
  };
  return { ...harness, ...overrides };
}

export function makeReadyRulesRun(): RulesAnalysisRun {
  return {
    runId: "rules-run-0000",
    analysisId: "analysis-00000000-0000-4000-8000-000000000000",
    ingestionId: "ingestion-0000",
    status: "READY",
    failureCode: null,
    isCurrent: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

export class FakeRulesAnalysisRunRepository implements RulesAnalysisRunRepositoryPort {
  current: RulesAnalysisRun | null = makeReadyRulesRun();

  async createCurrent(
    run: RulesAnalysisRun,
  ): Promise<"created_current" | "superseded"> {
    this.current = run;
    return "created_current";
  }

  async findCurrent() {
    return this.current;
  }

  async findRun() {
    return this.current;
  }

  async claimRunningIfCurrent(
    _runId: string,
    _analysisId: string,
    _ingestionId: string,
  ): Promise<SheetRunClaimResult> {
    return "claimed";
  }

  async finalizeIfCurrent() {
    return true;
  }

  async markFailedIfCurrent() {
    return true;
  }

  async confirmIfCurrent() {
    return true;
  }

  async markInvalidatedIfCurrent() {
    return true;
  }

  async invalidateRunsForGeneration() {
    return this.current === null ? [] : [this.current];
  }

  async listForAnalysis() {
    return this.current === null ? [] : [this.current];
  }

  async deleteAllForAnalysis() {}
}

export class FakeRulesArtifactStore implements RunArtifactPort {
  contexts = new Map<string, RulesContext>();
  failures: string[] = [];

  constructor() {
    const readyRun = makeReadyRulesRun();
    this.contexts.set(this.key(readyRun), makeRulesContext());
  }

  private key(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }) {
    return `${input.analysisId}:${input.ingestionId}:${input.runId}`;
  }

  async putContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    context: RulesContext;
  }) {
    this.contexts.set(this.key(input), input.context);
  }

  async getContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }) {
    if (this.failures.includes("getContext")) {
      throw new Error("R2 unavailable");
    }
    return this.contexts.get(this.key(input)) ?? null;
  }

  async putInput() {}
  async getInput() {
    return null;
  }
  async putRetrieval() {}
  async putVectorManifest() {}
  async getVectorManifest() {
    return null;
  }
  async deleteRunArtifacts() {}
}

let sheetIdSeed = 0;
export const sheetIdGenerator = {
  uuid: () => {
    sheetIdSeed += 1;
    return `sheet-run-${String(sheetIdSeed).padStart(4, "0")}`;
  },
};

export class FakeSheetRunRepository implements SheetGenerationRunRepositoryPort {
  readonly runs = new Map<string, SheetGenerationRun>();
  readonly currentByAnalysis = new Map<string, string>();

  async findCurrent(analysisId: string) {
    const runId = this.currentByAnalysis.get(analysisId);
    if (runId === undefined) {
      return null;
    }
    const row = this.runs.get(runId);
    return row !== undefined && row.isCurrent ? row : null;
  }

  async findRun(analysisId: string, runId: string) {
    const row = this.runs.get(runId);
    return row === undefined || row.analysisId !== analysisId ? null : row;
  }

  async createCurrent(
    run: SheetGenerationRun,
  ): Promise<SheetRunCreationResult> {
    const existingRunId = this.currentByAnalysis.get(run.analysisId);
    const existing =
      existingRunId === undefined ? undefined : this.runs.get(existingRunId);
    if (
      existing !== undefined &&
      existing.isCurrent &&
      existing.status !== "FAILED"
    ) {
      return "superseded";
    }
    if (existing !== undefined) {
      this.runs.set(existing.runId, { ...existing, isCurrent: false });
    }
    this.runs.set(run.runId, { ...run, isCurrent: true });
    this.currentByAnalysis.set(run.analysisId, run.runId);
    return "created_current";
  }

  async claimGeneratingIfCurrent(
    runId: string,
    analysisId: string,
    rulesAnalysisRunId: string,
    ingestionId: string,
  ): Promise<SheetRunClaimResult> {
    const row = this.runs.get(runId);
    if (
      row === undefined ||
      !row.isCurrent ||
      row.analysisId !== analysisId ||
      row.rulesAnalysisRunId !== rulesAnalysisRunId ||
      row.ingestionId !== ingestionId ||
      (row.status !== "QUEUED" && row.status !== "GENERATING")
    ) {
      return "not_current";
    }
    this.runs.set(runId, { ...row, status: "GENERATING" });
    return "claimed";
  }

  async claimCompilingIfCurrent(runId: string) {
    const row = this.runs.get(runId);
    if (row === undefined || !row.isCurrent || row.status !== "GENERATING") {
      return false;
    }
    this.runs.set(runId, { ...row, status: "COMPILING" });
    return true;
  }

  async finalizeReadyIfCurrent(runId: string) {
    const row = this.runs.get(runId);
    if (row === undefined || !row.isCurrent || row.status !== "COMPILING") {
      return false;
    }
    this.runs.set(runId, { ...row, status: "READY" });
    return true;
  }

  async markFailedIfCurrent(
    runId: string,
    failureCode: SheetGenerationFailureCode,
    updatedAt: Date,
  ) {
    const row = this.runs.get(runId);
    if (row === undefined || !row.isCurrent) {
      return false;
    }
    this.runs.set(runId, { ...row, status: "FAILED", failureCode, updatedAt });
    return true;
  }

  async markInvalidatedIfCurrent(runId: string, updatedAt: Date) {
    const row = this.runs.get(runId);
    if (row === undefined || !row.isCurrent) {
      return false;
    }
    this.runs.set(runId, {
      ...row,
      status: "INVALIDATED",
      isCurrent: false,
      updatedAt,
    });
    return true;
  }

  /** Marks every non-terminal run INVALIDATED and non-current; returns rows. */
  async invalidateSheetsForAnalysis(analysisId: string) {
    const affected: SheetGenerationRun[] = [];
    for (const [runId, row] of this.runs) {
      if (
        row.analysisId !== analysisId ||
        row.status === "FAILED" ||
        row.status === "INVALIDATED"
      ) {
        continue;
      }
      const updated: SheetGenerationRun = {
        ...row,
        status: "INVALIDATED",
        isCurrent: false,
      };
      this.runs.set(runId, updated);
      if (this.currentByAnalysis.get(analysisId) === runId) {
        this.currentByAnalysis.delete(analysisId);
      }
      affected.push(updated);
    }
    return affected;
  }

  async listForAnalysis(analysisId: string) {
    return [...this.runs.values()].filter(
      (row) => row.analysisId === analysisId,
    );
  }

  async deleteAllForAnalysis(analysisId: string) {
    for (const [runId, row] of this.runs) {
      if (row.analysisId === analysisId) {
        this.runs.delete(runId);
      }
    }
    this.currentByAnalysis.delete(analysisId);
  }
}

export class FakeSheetArtifactStore implements SheetArtifactPort {
  inputs = new Map<
    string,
    {
      rulesAnalysisRunId: string;
      ingestionId: string;
      context: RulesContext;
    }
  >();
  sectionPlans = new Map<string, SectionPlanOutput>();
  sectionFields = new Map<string, FieldCandidate[]>();
  calculations = new Map<string, CalculationCandidate[]>();
  specs = new Map<string, CharacterSheetSpec>();
  deleted = 0;
  failureCodes: string[] = [];

  private runKey(input: { analysisId: string; runId: string }) {
    return `${input.analysisId}:${input.runId}`;
  }

  maybeFail(operation: string) {
    if (this.failureCodes.includes(operation)) {
      throw new Error(`R2 unavailable for ${operation}`);
    }
  }

  async putInput(input: {
    analysisId: string;
    runId: string;
    rulesAnalysisRunId: string;
    ingestionId: string;
    context: RulesContext;
  }) {
    this.maybeFail("putInput");
    this.inputs.set(this.runKey(input), {
      rulesAnalysisRunId: input.rulesAnalysisRunId,
      ingestionId: input.ingestionId,
      context: input.context,
    });
  }

  async getInput(input: { analysisId: string; runId: string }) {
    this.maybeFail("getInput");
    const stored = this.inputs.get(this.runKey(input));
    if (stored === undefined) {
      return null;
    }
    return {
      version: 1 as const,
      runId: input.runId,
      analysisId: input.analysisId,
      rulesAnalysisRunId: stored.rulesAnalysisRunId,
      ingestionId: stored.ingestionId,
      context: stored.context,
    };
  }

  async putSectionPlan(input: {
    analysisId: string;
    runId: string;
    plan: SectionPlanOutput;
  }) {
    this.maybeFail("putSectionPlan");
    this.sectionPlans.set(this.runKey(input), input.plan);
  }

  async getSectionPlan(input: { analysisId: string; runId: string }) {
    this.maybeFail("getSectionPlan");
    const plan = this.sectionPlans.get(this.runKey(input));
    if (plan === undefined) {
      return null;
    }
    return {
      version: 1 as const,
      runId: input.runId,
      analysisId: input.analysisId,
      plan,
    };
  }

  async putSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
    fields: readonly FieldCandidate[];
  }) {
    this.maybeFail("putSectionFields");
    this.sectionFields.set(`${this.runKey(input)}:${input.sectionKey}`, [
      ...input.fields,
    ]);
  }

  async getSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
  }) {
    this.maybeFail("getSectionFields");
    const fields = this.sectionFields.get(
      `${this.runKey(input)}:${input.sectionKey}`,
    );
    if (fields === undefined) {
      return null;
    }
    return {
      version: 1 as const,
      runId: input.runId,
      analysisId: input.analysisId,
      sectionKey: input.sectionKey,
      fields,
    };
  }

  async putCalculations(input: {
    analysisId: string;
    runId: string;
    calculations: readonly CalculationCandidate[];
  }) {
    this.maybeFail("putCalculations");
    this.calculations.set(this.runKey(input), [...input.calculations]);
  }

  async getCalculations(input: { analysisId: string; runId: string }) {
    this.maybeFail("getCalculations");
    const calculations = this.calculations.get(this.runKey(input));
    if (calculations === undefined) {
      return null;
    }
    return {
      version: 1 as const,
      runId: input.runId,
      analysisId: input.analysisId,
      calculations,
    };
  }

  async putSpec(input: {
    analysisId: string;
    runId: string;
    spec: CharacterSheetSpec;
  }) {
    this.maybeFail("putSpec");
    this.specs.set(this.runKey(input), input.spec);
  }

  async getSpec(input: { analysisId: string; runId: string }) {
    this.maybeFail("getSpec");
    return this.specs.get(this.runKey(input)) ?? null;
  }

  async deleteRunArtifacts(input: { analysisId: string; runId: string }) {
    this.maybeFail("deleteRunArtifacts");
    this.deleted += 1;
    const key = this.runKey(input);
    this.inputs.delete(key);
    this.sectionPlans.delete(key);
    this.specs.delete(key);
    for (const [fieldsKey] of this.sectionFields) {
      if (fieldsKey.startsWith(`${key}:`)) {
        this.sectionFields.delete(fieldsKey);
      }
    }
    for (const [calcKey] of this.calculations) {
      if (calcKey === key) {
        this.calculations.delete(calcKey);
      }
    }
  }
}

export class FakeSheetGenerationPort implements SheetGenerationPort {
  calls: Array<{ stage: string; system: string; user: string }> = [];
  responses: string[] = [];
  failures: string[] = [];

  script(next: readonly (string | "THROW")[]) {
    this.responses.push(...next);
  }

  async generate(input: { stage: string; system: string; user: string }) {
    this.calls.push(input);
    if (this.failures.length > 0) {
      const failure = this.failures.shift()!;
      throw new Error(failure);
    }
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("Unexpected extra sheet-generation call.");
    }
    if (next === "THROW") {
      throw new Error("scripted failure");
    }
    return next;
  }
}

export class FakeInstructionExtractionPort implements InstructionExtractionPort {
  calls: Array<{ system: string; user: string }> = [];
  responses: string[] = [];
  failures: string[] = [];

  script(next: readonly (string | "THROW")[]) {
    this.responses.push(...next);
  }

  async generate(args: { system: string; user: string }) {
    this.calls.push(args);
    if (this.failures.length > 0) {
      const failure = this.failures.shift()!;
      throw new Error(failure);
    }
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("Unexpected extra instruction-extraction call.");
    }
    if (next === "THROW") {
      throw new Error("scripted failure");
    }
    return next;
  }
}

export class FakeRulebookFieldDerivationPort implements RulebookFieldDerivationPort {
  calls: Array<{ system: string; user: string }> = [];
  responses: string[] = [];
  failures: string[] = [];

  script(next: readonly (string | "THROW")[]) {
    this.responses.push(...next);
  }

  async derive(args: { system: string; user: string }) {
    this.calls.push(args);
    if (this.failures.length > 0) {
      const failure = this.failures.shift()!;
      throw new Error(failure);
    }
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("Unexpected extra rulebook-derivation call.");
    }
    if (next === "THROW") {
      throw new Error("scripted failure");
    }
    return next;
  }
}
