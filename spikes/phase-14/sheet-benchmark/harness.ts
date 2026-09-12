import {
  compileCharacterSheet,
  compileSheetGeneration,
  generateSectionFields,
  generateSectionPlan,
  generateSheetCalculations,
  parseCalculationCandidates,
  parseFieldCandidates,
  parseSectionPlan,
  SheetCompileError,
  validateCalculationCandidatesAgainstContext,
  validateFieldCandidatesAgainstContext,
  validateSectionPlanAgainstContext,
  type CalculationCandidate,
  type FieldCandidate,
  type SectionPlanOutput,
  type SheetArtifactPort,
  type SheetGenerationCalculationsArtifact,
  type SheetGenerationFailureCode,
  type SheetGenerationFieldsArtifact,
  type SheetGenerationInputArtifact,
  type SheetGenerationPort,
  type SheetGenerationRun,
  type SheetGenerationRunRepositoryPort,
  type SheetGenerationSectionPlanArtifact,
  type SheetGenerationStage,
} from "@repo/character-sheet-generation";
import {
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import { z } from "zod";
import {
  FIXED_NOW,
  INGESTION_ID,
  RULES_ANALYSIS_RUN_ID,
  SHEET_RUN_ID,
  type SheetBenchmarkFixture,
} from "./fixtures.js";
import type { BenchmarkPersona, PersonaSlug } from "./personas.js";
import { getPersona } from "./personas.js";
import { PersonaAwarePort, shouldAbort } from "./persona-deltas.js";

/**
 * Benchmark-side failure taxonomy. The 8 classes distinguish model-output
 * problems from production-validation defects and from acceptance/coverage
 * shortfalls so an observability run can point at the responsible layer.
 * `acceptance_coverage` is not a stage fault; metrics assigns it only when every
 * pipeline stage succeeded but a fixture acceptance check failed.
 */
export type FailureTaxonomy =
  | "provider_transport"
  | "json_parse"
  | "structured_output"
  | "semantic_validation"
  | "compiler"
  | "canonical_schema"
  | "canonical_domain"
  | "acceptance_coverage";

export interface SheetGenerationCallMetadata {
  readonly finishReason: string | null;
  readonly usage: unknown;
}

/** Benchmark-only optional extension used by the recording port. */
export interface SheetGenerationPortWithMetadata extends SheetGenerationPort {
  readonly lastMetadata: SheetGenerationCallMetadata | null;
}

export interface SheetGenerationCallRecord {
  readonly stage: SheetGenerationStage;
  readonly sectionKey: string | null;
  readonly slot: string;
  readonly attemptNumber: number;
  readonly isCorrectionReplay: boolean;
  readonly system: string;
  readonly user: string;
  readonly raw: string;
  readonly responseLength: number;
  readonly error: { readonly name: string; readonly message: string } | null;
  readonly finishReason: string | null;
  readonly usage: unknown;
  readonly elapsedMs: number;
}

export interface StageDiagnostic {
  readonly taxonomy: FailureTaxonomy;
  readonly detail: string | null;
  readonly errorName: string | null;
}

export interface StageResultRecord {
  readonly stage: string;
  readonly kind: "ok" | "failed" | "skipped";
  readonly failureCode: SheetGenerationFailureCode | null;
  readonly diagnostic: StageDiagnostic | null;
}

export interface CompileDiagnostics {
  readonly failureCode: SheetGenerationFailureCode;
  readonly taxonomy: FailureTaxonomy;
  readonly compilerError: string | null;
  readonly domainIssues: readonly string[];
  readonly schemaError: string | null;
}

export interface FixtureRunResult {
  readonly fixtureId: string;
  readonly injection: boolean;
  readonly role: "player" | "npc";
  readonly language: "en" | "es";
  readonly persona: PersonaSlug | null;
  readonly stageResults: readonly StageResultRecord[];
  readonly calls: readonly SheetGenerationCallRecord[];
  readonly compileDiagnostics: CompileDiagnostics | null;
  readonly run: SheetGenerationRun | null;
  readonly spec: CharacterSheetSpec | null;
  readonly plan: SectionPlanOutput | null;
  readonly fieldsBySection: readonly {
    readonly sectionKey: string;
    readonly fields: readonly FieldCandidate[];
  }[];
  readonly calculations: readonly CalculationCandidate[];
}

/**
 * Extracts the section key a field-candidates prompt targets. The production
 * prompt always emits the `## Section to fill` header with `key: <id>`, which
 * makes this a stable recording-time identifier for attempt accounting.
 */
export function extractSectionKey(user: string): string | null {
  const match = user.match(/## Section to fill\s+key: ([a-z0-9_]+)/i);
  return match?.[1] ?? null;
}

/**
 * Records every provider call, its elapsed time, and structured attempt metadata
 * so the benchmark can count first attempts vs correction replays per slot and
 * aggregate per-stage latency without guessing from call totals.
 */
export class RecordingSheetGenerationPort implements SheetGenerationPort {
  readonly calls: SheetGenerationCallRecord[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(private readonly inner: SheetGenerationPort) {}

  async generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string> {
    const startedAt = performance.now();
    const slot = slotFor(input.stage, input.user);
    const attemptNumber = (this.attempts.get(slot) ?? 0) + 1;
    this.attempts.set(slot, attemptNumber);
    const isCorrectionReplay = attemptNumber > 1;
    const sectionKey =
      input.stage === "field-candidates" ? extractSectionKey(input.user) : null;
    const metadata = readMetadata(this.inner);

    try {
      const raw = await this.inner.generate(input);
      this.calls.push({
        stage: input.stage,
        sectionKey,
        slot,
        attemptNumber,
        isCorrectionReplay,
        system: input.system,
        user: input.user,
        raw,
        responseLength: raw.length,
        error: null,
        finishReason: metadata?.finishReason ?? null,
        usage: metadata?.usage ?? null,
        elapsedMs: roundMs(performance.now() - startedAt),
      });
      return raw;
    } catch (error) {
      this.calls.push({
        stage: input.stage,
        sectionKey,
        slot,
        attemptNumber,
        isCorrectionReplay,
        system: input.system,
        user: input.user,
        raw: "",
        responseLength: 0,
        error: {
          name: error instanceof Error ? error.name : "Unknown",
          message:
            error instanceof Error ? error.message : "Unknown provider error",
        },
        finishReason: metadata?.finishReason ?? null,
        usage: metadata?.usage ?? null,
        elapsedMs: roundMs(performance.now() - startedAt),
      });
      throw error;
    }
  }
}

function slotFor(stage: SheetGenerationStage, user: string): string {
  return stage === "field-candidates"
    ? `field-candidates:${extractSectionKey(user) ?? "unknown"}`
    : stage;
}

function readMetadata(
  port: SheetGenerationPort,
): SheetGenerationCallMetadata | null {
  const metadata = (port as Partial<SheetGenerationPortWithMetadata>)
    .lastMetadata;
  return metadata === undefined || metadata === null ? null : metadata;
}

/**
 * Calls the benchmark shim worker (localhost dev server) with the same request
 * shape the production adapter would produce.
 */
export class RemoteSheetGenerationPort implements SheetGenerationPortWithMetadata {
  lastMetadata: SheetGenerationCallMetadata | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly persona: PersonaSlug | null = null,
  ) {}

  async generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/sheets/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stage: input.stage,
        system: input.system,
        user: input.user,
        persona: this.persona,
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      readonly success?: unknown;
      readonly text?: unknown;
      readonly error?: unknown;
      readonly finishReason?: unknown;
      readonly usage?: unknown;
    } | null;

    if (!response.ok || body?.success !== true) {
      const detail =
        body?.error === undefined ? "Unknown error" : String(body.error);
      throw new Error(`Sheet benchmark stage failed: ${detail}`);
    }
    if (typeof body.text !== "string" || body.text.length === 0) {
      throw new Error("Sheet benchmark stage returned no usable text.");
    }
    this.lastMetadata = {
      finishReason:
        typeof body.finishReason === "string" ? body.finishReason : null,
      usage: body.usage ?? null,
    };
    return body.text;
  }
}

/**
 * In-memory CAS mirror of the D1 sheet-run repository. Every mutation verifies
 * the run is still current, and the generating claim enforces the same
 * triple-identity guard and QUEUED/GENERATING status window as production.
 */
export class FakeSheetGenerationRunRepository implements SheetGenerationRunRepositoryPort {
  private currentByAnalysis = new Map<string, SheetGenerationRun>();
  private runsByAnalysis = new Map<string, SheetGenerationRun[]>();

  seedCurrent(run: SheetGenerationRun): void {
    this.currentByAnalysis.set(run.analysisId, run);
    this.appendRun(run);
  }

  private appendRun(run: SheetGenerationRun): void {
    const list = this.runsByAnalysis.get(run.analysisId) ?? [];
    list.push(run);
    this.runsByAnalysis.set(run.analysisId, list);
  }

  private replaceCurrentIfMatches(run: SheetGenerationRun): boolean {
    const current = this.currentByAnalysis.get(run.analysisId);
    if (current === undefined || current.runId !== run.runId) {
      return false;
    }
    this.currentByAnalysis.set(run.analysisId, run);
    this.replaceRun(run);
    return true;
  }

  private replaceRun(run: SheetGenerationRun): void {
    const list = this.runsByAnalysis.get(run.analysisId);
    if (list === undefined) {
      return;
    }
    const index = list.findIndex((item) => item.runId === run.runId);
    if (index >= 0) {
      list[index] = run;
    }
  }

  async findCurrent(analysisId: string): Promise<SheetGenerationRun | null> {
    return this.currentByAnalysis.get(analysisId) ?? null;
  }

  async findRun(
    analysisId: string,
    runId: string,
  ): Promise<SheetGenerationRun | null> {
    const list = this.runsByAnalysis.get(analysisId);
    return list?.find((run) => run.runId === runId) ?? null;
  }

  async createCurrent(
    run: SheetGenerationRun,
  ): Promise<"created_current" | "superseded"> {
    const existing = this.currentByAnalysis.get(run.analysisId);
    if (existing !== undefined) {
      return "superseded";
    }
    this.currentByAnalysis.set(run.analysisId, run);
    this.appendRun(run);
    return "created_current";
  }

  async claimGeneratingIfCurrent(
    runId: string,
    analysisId: string,
    rulesAnalysisRunId: string,
    ingestionId: string,
  ): Promise<"claimed" | "not_current"> {
    const run = this.currentByAnalysis.get(analysisId);
    if (run === undefined || run.runId !== runId) {
      return "not_current";
    }
    if (
      run.rulesAnalysisRunId !== rulesAnalysisRunId ||
      run.ingestionId !== ingestionId
    ) {
      return "not_current";
    }
    if (run.status !== "QUEUED" && run.status !== "GENERATING") {
      return "not_current";
    }
    const mutated: SheetGenerationRun = {
      ...run,
      status: "GENERATING",
      updatedAt: FIXED_NOW,
    };
    this.replaceCurrentIfMatches(mutated);
    return "claimed";
  }

  async claimCompilingIfCurrent(runId: string): Promise<boolean> {
    for (const run of this.currentByAnalysis.values()) {
      if (run.runId !== runId || run.status !== "GENERATING") {
        continue;
      }
      const mutated: SheetGenerationRun = {
        ...run,
        status: "COMPILING",
        updatedAt: FIXED_NOW,
      };
      return this.replaceCurrentIfMatches(mutated);
    }
    return false;
  }

  async finalizeReadyIfCurrent(runId: string): Promise<boolean> {
    for (const run of this.currentByAnalysis.values()) {
      if (run.runId !== runId || run.status !== "COMPILING") {
        continue;
      }
      const mutated: SheetGenerationRun = {
        ...run,
        status: "READY",
        updatedAt: FIXED_NOW,
      };
      return this.replaceCurrentIfMatches(mutated);
    }
    return false;
  }

  async markFailedIfCurrent(
    runId: string,
    failureCode: SheetGenerationFailureCode,
    updatedAt: Date,
  ): Promise<boolean> {
    for (const run of this.currentByAnalysis.values()) {
      if (run.runId !== runId) {
        continue;
      }
      const mutated: SheetGenerationRun = {
        ...run,
        status: "FAILED",
        failureCode,
        updatedAt,
      };
      return this.replaceCurrentIfMatches(mutated);
    }
    return false;
  }

  async markInvalidatedIfCurrent(
    runId: string,
    updatedAt: Date,
  ): Promise<boolean> {
    for (const run of this.currentByAnalysis.values()) {
      if (run.runId !== runId) {
        continue;
      }
      const mutated: SheetGenerationRun = {
        ...run,
        status: "INVALIDATED",
        isCurrent: false,
        updatedAt,
      };
      return this.replaceCurrentIfMatches(mutated);
    }
    return false;
  }

  async invalidateSheetsForAnalysis(
    analysisId: string,
  ): Promise<readonly SheetGenerationRun[]> {
    const affected: SheetGenerationRun[] = [];
    const list = this.runsByAnalysis.get(analysisId) ?? [];
    for (const run of list) {
      if (
        run.status === "QUEUED" ||
        run.status === "GENERATING" ||
        run.status === "COMPILING" ||
        run.status === "READY"
      ) {
        const mutated: SheetGenerationRun = {
          ...run,
          status: "INVALIDATED",
          isCurrent: false,
          updatedAt: FIXED_NOW,
        };
        affected.push(mutated);
      }
    }
    for (const run of affected) {
      this.replaceRun(run);
    }
    this.currentByAnalysis.delete(analysisId);
    return affected;
  }

  async listForAnalysis(
    analysisId: string,
  ): Promise<readonly SheetGenerationRun[]> {
    return this.runsByAnalysis.get(analysisId) ?? [];
  }

  async deleteAllForAnalysis(analysisId: string): Promise<void> {
    this.runsByAnalysis.delete(analysisId);
    this.currentByAnalysis.delete(analysisId);
  }
}

/**
 * In-memory mirror of the temporary R2 sheet artifact store. Every artifact is
 * keyed by the run identity that wrote it.
 */
export class FakeSheetArtifactStore implements SheetArtifactPort {
  private inputByKey = new Map<string, SheetGenerationInputArtifact>();
  private planByKey = new Map<string, SheetGenerationSectionPlanArtifact>();
  private fieldsByKey = new Map<string, SheetGenerationFieldsArtifact>();
  private calculationsByKey = new Map<
    string,
    SheetGenerationCalculationsArtifact
  >();
  private specByKey = new Map<string, CharacterSheetSpec>();

  private readonly key = (analysisId: string, runId: string) =>
    `${analysisId}/${runId}`;

  async putInput(input: {
    analysisId: string;
    runId: string;
    rulesAnalysisRunId: string;
    ingestionId: string;
    context: RulesContext;
  }): Promise<void> {
    this.inputByKey.set(this.key(input.analysisId, input.runId), {
      version: 1,
      runId: input.runId,
      analysisId: input.analysisId,
      rulesAnalysisRunId: input.rulesAnalysisRunId,
      ingestionId: input.ingestionId,
      context: input.context,
    });
  }

  async getInput(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationInputArtifact | null> {
    return this.inputByKey.get(this.key(input.analysisId, input.runId)) ?? null;
  }

  async putSectionPlan(input: {
    analysisId: string;
    runId: string;
    plan: SectionPlanOutput;
  }): Promise<void> {
    this.planByKey.set(this.key(input.analysisId, input.runId), {
      version: 1,
      runId: input.runId,
      analysisId: input.analysisId,
      plan: input.plan,
    });
  }

  async getSectionPlan(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationSectionPlanArtifact | null> {
    return this.planByKey.get(this.key(input.analysisId, input.runId)) ?? null;
  }

  async putSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
    fields: readonly FieldCandidate[];
  }): Promise<void> {
    this.fieldsByKey.set(
      `${this.key(input.analysisId, input.runId)}/${input.sectionKey}`,
      {
        version: 1,
        runId: input.runId,
        analysisId: input.analysisId,
        sectionKey: input.sectionKey,
        fields: [...input.fields],
      },
    );
  }

  async getSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
  }): Promise<SheetGenerationFieldsArtifact | null> {
    return (
      this.fieldsByKey.get(
        `${this.key(input.analysisId, input.runId)}/${input.sectionKey}`,
      ) ?? null
    );
  }

  async putCalculations(input: {
    analysisId: string;
    runId: string;
    calculations: readonly CalculationCandidate[];
  }): Promise<void> {
    this.calculationsByKey.set(this.key(input.analysisId, input.runId), {
      version: 1,
      runId: input.runId,
      analysisId: input.analysisId,
      calculations: [...input.calculations],
    });
  }

  async getCalculations(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationCalculationsArtifact | null> {
    return (
      this.calculationsByKey.get(this.key(input.analysisId, input.runId)) ??
      null
    );
  }

  async putSpec(input: {
    analysisId: string;
    runId: string;
    spec: CharacterSheetSpec;
  }): Promise<void> {
    this.specByKey.set(this.key(input.analysisId, input.runId), input.spec);
  }

  async getSpec(input: {
    analysisId: string;
    runId: string;
  }): Promise<CharacterSheetSpec | null> {
    return this.specByKey.get(this.key(input.analysisId, input.runId)) ?? null;
  }

  async deleteRunArtifacts(input: {
    analysisId: string;
    runId: string;
  }): Promise<void> {
    const prefix = `${this.key(input.analysisId, input.runId)}`;
    for (const map of [
      this.inputByKey,
      this.planByKey,
      this.calculationsByKey,
      this.specByKey,
    ]) {
      map.delete(prefix);
    }
    for (const mapKey of this.fieldsByKey.keys()) {
      if (mapKey.startsWith(`${prefix}/`)) {
        this.fieldsByKey.delete(mapKey);
      }
    }
  }
}

function roundMs(elapsed: number): number {
  return Math.round(elapsed * 100) / 100;
}

function toStageRecord(
  stage: string,
  result: {
    kind: "ok" | "failed" | "skipped";
    failureCode?: SheetGenerationFailureCode;
  },
): StageResultRecord {
  return {
    stage,
    kind: result.kind,
    failureCode: result.kind === "failed" ? (result.failureCode ?? null) : null,
    diagnostic: null,
  };
}

/**
 * Maps a production failure code to the benchmark taxonomy when a defect cannot
 * be reproduced from the recorded raw outputs (defensive fallback only; the
 * harness normally reproduces the defect at recording time).
 */
export function taxonomyFromFailureCode(
  failureCode: SheetGenerationFailureCode | null,
): FailureTaxonomy | null {
  switch (failureCode) {
    case "CHARACTER_SHEET_MODEL_UNAVAILABLE":
    case "CHARACTER_SHEET_STORAGE_UNAVAILABLE":
    case "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY":
      return "provider_transport";
    case "CHARACTER_SHEET_PLAN_OUTPUT_INVALID":
    case "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID":
    case "CHARACTER_SHEET_CALCULATIONS_OUTPUT_INVALID":
      return "structured_output";
    case "CHARACTER_SHEET_DOMAIN_INVALID":
      return "canonical_domain";
    case "CHARACTER_SHEET_COMPILE_FAILED":
      return "compiler";
    default:
      return null;
  }
}

function taxonomyForParseError(parseError: string): FailureTaxonomy {
  return parseError.startsWith("The model response was not valid JSON.")
    ? "json_parse"
    : "structured_output";
}

function collectEarlierUsedFields(
  targetSectionKey: string,
  plan: SectionPlanOutput | null,
  fieldsBySection: readonly {
    readonly sectionKey: string;
    readonly fields: readonly FieldCandidate[];
  }[],
): readonly { key: string; type: FieldCandidate["type"] }[] {
  const keys: { key: string; type: FieldCandidate["type"] }[] = [];
  if (plan === null) {
    return keys;
  }
  const targetIndex = plan.sections.findIndex(
    (section) => section.key === targetSectionKey,
  );
  const earlierOrder = new Set(
    plan.sections.slice(0, targetIndex).map((section) => section.key),
  );
  for (const entry of fieldsBySection) {
    if (earlierOrder.has(entry.sectionKey)) {
      for (const field of entry.fields) {
        keys.push({ key: field.key, type: field.type });
      }
    }
  }
  return keys;
}

/**
 * Re-runs the same pure production validators the stage used, against the
 * recorded raw, to reproduce why a stage failed. Production services are read
 * from but never modified; this is benchmark-side evidence only.
 */
function diagnoseFailedStage(input: {
  readonly stage: StageResultRecord;
  readonly calls: readonly SheetGenerationCallRecord[];
  readonly plan: SectionPlanOutput | null;
  readonly fieldsBySection: readonly {
    readonly sectionKey: string;
    readonly fields: readonly FieldCandidate[];
  }[];
  readonly context: RulesContext;
}): StageDiagnostic | null {
  const { stage } = input;
  if (stage.kind !== "failed") {
    return null;
  }
  if (stage.stage === "compile") {
    return null; // attached from reproduceCompileDiagnostics by the caller.
  }
  const slotName =
    stage.stage === "section-plan"
      ? "section-plan"
      : stage.stage.startsWith("fields:")
        ? `field-candidates:${stage.stage.slice("fields:".length)}`
        : "calculations";
  const stageCalls = input.calls.filter((call) => call.slot === slotName);
  const last = stageCalls[stageCalls.length - 1];
  if (last === undefined) {
    return {
      taxonomy:
        taxonomyFromFailureCode(stage.failureCode) ?? "semantic_validation",
      detail: null,
      errorName: null,
    };
  }
  if (last.error !== null) {
    return {
      taxonomy: "provider_transport",
      detail: last.error.message,
      errorName: last.error.name,
    };
  }

  if (stage.stage === "section-plan") {
    const parsed = parseSectionPlan(last.raw);
    if (!parsed.ok) {
      return {
        taxonomy: taxonomyForParseError(parsed.error),
        detail: parsed.error,
        errorName: null,
      };
    }
    const invalid = validateSectionPlanAgainstContext(
      parsed.plan,
      input.context,
    );
    if (invalid !== null) {
      return {
        taxonomy: "semantic_validation",
        detail: invalid,
        errorName: null,
      };
    }
    return {
      taxonomy:
        taxonomyFromFailureCode(stage.failureCode) ?? "structured_output",
      detail: "Stage failed without a reproducible defect.",
      errorName: null,
    };
  }

  if (stage.stage.startsWith("fields:")) {
    const sectionKey = stage.stage.slice("fields:".length);
    const parsed = parseFieldCandidates(last.raw);
    if (!parsed.ok) {
      return {
        taxonomy: taxonomyForParseError(parsed.error),
        detail: parsed.error,
        errorName: null,
      };
    }
    const earlierUsedFields = collectEarlierUsedFields(
      sectionKey,
      input.plan,
      input.fieldsBySection,
    );
    const invalid = validateFieldCandidatesAgainstContext(
      parsed.fields.fields,
      input.context,
      new Set(earlierUsedFields.map((entry) => entry.key)),
      new Map(earlierUsedFields.map((entry) => [entry.key, entry.type])),
    );
    if (invalid !== null) {
      return {
        taxonomy: "semantic_validation",
        detail: invalid,
        errorName: null,
      };
    }
    return {
      taxonomy:
        taxonomyFromFailureCode(stage.failureCode) ?? "structured_output",
      detail: "Stage failed without a reproducible defect.",
      errorName: null,
    };
  }

  const parsed = parseCalculationCandidates(last.raw);
  if (!parsed.ok) {
    return {
      taxonomy: taxonomyForParseError(parsed.error),
      detail: parsed.error,
      errorName: null,
    };
  }
  const sectionOrder = new Map<string, number>();
  if (input.plan !== null) {
    input.plan.sections.forEach((section, index) => {
      sectionOrder.set(section.key, index);
    });
  }
  const fieldIndex = input.fieldsBySection.flatMap((entry) =>
    entry.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      sectionKey: entry.sectionKey,
      sectionOrder: sectionOrder.get(entry.sectionKey) ?? 0,
    })),
  );
  const invalid = validateCalculationCandidatesAgainstContext(
    parsed.calculations.calculations,
    fieldIndex,
  );
  if (invalid !== null) {
    return {
      taxonomy: "semantic_validation",
      detail: invalid,
      errorName: null,
    };
  }
  return {
    taxonomy: taxonomyFromFailureCode(stage.failureCode) ?? "structured_output",
    detail: "Stage failed without a reproducible defect.",
    errorName: null,
  };
}

/**
 * Reproduces a failed compile step by re-running the pure production piepline
 * (compile + domain validation + schema parse) and normalizing the fault.
 */
function reproduceCompileDiagnostics(input: {
  readonly context: RulesContext;
  readonly plan: SectionPlanOutput;
  readonly fieldsBySection: readonly {
    readonly sectionKey: string;
    readonly fields: readonly FieldCandidate[];
  }[];
  readonly calculations: readonly CalculationCandidate[];
}): CompileDiagnostics {
  const fieldsBySection = new Map(
    input.fieldsBySection.map((entry) => [entry.sectionKey, entry.fields]),
  );
  try {
    const spec = compileCharacterSheet({
      context: input.context,
      plan: input.plan,
      fieldsBySection,
      calculations: input.calculations,
    });
    const domain = validateCharacterSheetSpecDomain(spec, input.context);
    if (!domain.valid) {
      return {
        failureCode: "CHARACTER_SHEET_DOMAIN_INVALID",
        taxonomy: "canonical_domain",
        compilerError: null,
        domainIssues: domain.issues.map(
          (issue) => `${issue.code}@${issue.path.join(".")}`,
        ),
        schemaError: null,
      };
    }
    return {
      failureCode: "CHARACTER_SHEET_COMPILE_FAILED",
      taxonomy: "canonical_schema",
      compilerError: null,
      domainIssues: [],
      schemaError:
        "Compile-stage failure could not be reproduced from the recorded artifacts.",
    };
  } catch (error) {
    if (error instanceof SheetCompileError) {
      return {
        failureCode:
          error.reason === "candidate_invalid"
            ? "CHARACTER_SHEET_DOMAIN_INVALID"
            : "CHARACTER_SHEET_COMPILE_FAILED",
        taxonomy: "compiler",
        compilerError: error.details,
        domainIssues: [],
        schemaError: null,
      };
    }
    if (error instanceof z.ZodError) {
      return {
        failureCode: "CHARACTER_SHEET_COMPILE_FAILED",
        taxonomy: "canonical_schema",
        compilerError: null,
        domainIssues: [],
        schemaError: error.message,
      };
    }
    return {
      failureCode: "CHARACTER_SHEET_COMPILE_FAILED",
      taxonomy: "compiler",
      compilerError:
        error instanceof Error ? error.message : "Unknown compile failure.",
      domainIssues: [],
      schemaError: null,
    };
  }
}

/**
 * Runs one fixture through the real production sheet-generation services using
 * the shimmed provider port. `beginSheetGenerationRun` is intentionally skipped:
 * the harness seeds the current run in QUEUED and the canonical input artifact,
 * so the measured surface is exactly sections -> fields -> calculations ->
 * compile with the provider calls routed to the candidate model.
 *
 * When a persona is provided, the port is wrapped with a PersonaAwarePort that
 * applies persona-specific prompt deltas, anchored replay, and bounded abort.
 */
export async function runFixtureThroughPipeline(input: {
  readonly fixture: SheetBenchmarkFixture;
  readonly port: SheetGenerationPort;
  readonly persona?: PersonaSlug;
}): Promise<FixtureRunResult> {
  const persona: BenchmarkPersona | null =
    input.persona !== undefined ? getPersona(input.persona) : null;

  const analysisId = input.fixture.context.analysisId;
  const queuedRun: SheetGenerationRun = {
    runId: SHEET_RUN_ID,
    analysisId,
    rulesAnalysisRunId: RULES_ANALYSIS_RUN_ID,
    ingestionId: INGESTION_ID,
    status: "QUEUED",
    failureCode: null,
    isCurrent: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };

  const runRepository = new FakeSheetGenerationRunRepository();
  runRepository.seedCurrent(queuedRun);

  const artifactStore = new FakeSheetArtifactStore();
  await artifactStore.putInput({
    analysisId,
    runId: SHEET_RUN_ID,
    rulesAnalysisRunId: RULES_ANALYSIS_RUN_ID,
    ingestionId: INGESTION_ID,
    context: input.fixture.context,
  });

  const innerPort = input.port;
  const personaPort =
    persona !== null ? new PersonaAwarePort(innerPort, persona) : null;
  const effectivePort = personaPort ?? innerPort;
  const recording = new RecordingSheetGenerationPort(effectivePort);
  const deps = {
    clock: { now: (): Date => FIXED_NOW },
    runRepository,
    artifactStore,
    sheetGeneration: recording,
  };

  const stageResults: StageResultRecord[] = [];
  const fieldsBySection: {
    sectionKey: string;
    fields: readonly FieldCandidate[];
  }[] = [];

  const planResult = await generateSectionPlan(
    { analysisId, runId: SHEET_RUN_ID },
    deps,
  );
  stageResults.push(toStageRecord("section-plan", planResult));
  let plan: SectionPlanOutput | null =
    planResult.kind === "ok" ? planResult.value : null;

  if (personaPort !== null && plan !== null) {
    personaPort.setPreviousPlan(plan);
  }

  if (plan !== null) {
    for (const section of plan.sections) {
      const fieldsResult = await generateSectionFields(
        { analysisId, runId: SHEET_RUN_ID, sectionKey: section.key },
        deps,
      );
      stageResults.push(toStageRecord(`fields:${section.key}`, fieldsResult));
      if (fieldsResult.kind === "ok") {
        fieldsBySection.push({
          sectionKey: section.key,
          fields: fieldsResult.value.fields,
        });
      }
    }
  }

  const calculationsResult = await generateSheetCalculations(
    { analysisId, runId: SHEET_RUN_ID },
    deps,
  );
  stageResults.push(toStageRecord("calculations", calculationsResult));
  const calculations: readonly CalculationCandidate[] =
    calculationsResult.kind === "ok" ? calculationsResult.value : [];

  const compileResult = await compileSheetGeneration(
    { analysisId, runId: SHEET_RUN_ID },
    deps,
  );
  stageResults.push(toStageRecord("compile", compileResult));
  const spec: CharacterSheetSpec | null =
    compileResult.kind === "ok" ? compileResult.value : null;

  const finalRun = await runRepository.findCurrent(analysisId);
  const currentPlan = await artifactStore.getSectionPlan({
    analysisId,
    runId: SHEET_RUN_ID,
  });
  const currentCalculations = await artifactStore.getCalculations({
    analysisId,
    runId: SHEET_RUN_ID,
  });
  const resolvedPlan = currentPlan?.plan ?? null;

  const compileStage = stageResults.find((stage) => stage.stage === "compile");
  const compileDiagnostics =
    compileStage?.kind === "failed" && resolvedPlan !== null
      ? reproduceCompileDiagnostics({
          context: input.fixture.context,
          plan: resolvedPlan,
          fieldsBySection,
          calculations: currentCalculations?.calculations ?? [],
        })
      : null;

  const resolvedStages = stageResults.map((stage) => {
    if (stage.stage === "compile") {
      return {
        ...stage,
        diagnostic:
          compileDiagnostics === null
            ? null
            : {
                taxonomy: compileDiagnostics.taxonomy,
                detail:
                  compileDiagnostics.compilerError ??
                  compileDiagnostics.schemaError,
                errorName: null,
              },
      };
    }
    return {
      ...stage,
      diagnostic: diagnoseFailedStage({
        stage,
        calls: recording.calls,
        plan: resolvedPlan,
        fieldsBySection,
        context: input.fixture.context,
      }),
    };
  });

  return {
    fixtureId: input.fixture.id,
    injection: input.fixture.injection,
    role: input.fixture.role,
    language: input.fixture.language,
    persona: persona?.slug ?? null,
    stageResults: resolvedStages,
    calls: recording.calls,
    compileDiagnostics,
    run: finalRun,
    spec,
    plan: resolvedPlan,
    fieldsBySection,
    calculations: currentCalculations?.calculations ?? [],
  };
}
