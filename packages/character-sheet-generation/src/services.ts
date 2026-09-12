import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import {
  validateRulesContextDomain,
  type RulesContext,
} from "@repo/rules-context";
import type {
  RulesAnalysisRunRepositoryPort,
  RunArtifactPort,
} from "@repo/rules-analysis-run";
import type { Clock } from "@repo/rules-analysis-session";
import { compileCharacterSheet, SheetCompileError } from "./compiler.js";
import {
  type CalculationCandidate,
  type CalculationFieldIndexEntry,
  type FieldCandidate,
  type FieldCandidatesOutput,
  type SectionPlanOutput,
} from "./intermediate.js";
import {
  appendValidationFeedback,
  buildCalculationSystemPrompt,
  buildCalculationUserPrompt,
  buildFieldSystemPrompt,
  buildFieldUserPrompt,
  buildSectionPlanSystemPrompt,
  buildSectionPlanUserPrompt,
} from "./prompt.js";
import {
  parseCalculationCandidates,
  parseFieldCandidates,
  parseSectionPlan,
  validateCalculationCandidatesAgainstContext,
  validateFieldCandidatesAgainstContext,
  validateSectionPlanAgainstContext,
} from "./generate.js";
import type { SheetArtifactPort, SheetGenerationPort } from "./ports.js";
import type { SheetGenerationRunRepositoryPort } from "./repository.js";
import {
  SHEET_GENERATION_RETRIES,
  type SheetGenerationFailureCode,
  type SheetGenerationRun,
} from "./model.js";

export interface SheetGenerationIdGenerator {
  uuid(): string;
}

export interface BeginSheetGenerationDeps {
  clock: Clock;
  idGenerator: SheetGenerationIdGenerator;
  runRepository: SheetGenerationRunRepositoryPort;
  rulesAnalysisRunRepository: RulesAnalysisRunRepositoryPort;
  rulesArtifactStore: RunArtifactPort;
  artifactStore: SheetArtifactPort;
}

export interface SheetGenerationStageDeps {
  clock: Clock;
  runRepository: SheetGenerationRunRepositoryPort;
  artifactStore: SheetArtifactPort;
  sheetGeneration: SheetGenerationPort;
}

export type BeginSheetGenerationResult =
  | { kind: "started"; run: SheetGenerationRun }
  | { kind: "run_already_exists"; run: SheetGenerationRun | null }
  | { kind: "rules_context_not_ready" }
  | { kind: "storage_unavailable" };

export type SheetStageResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed"; failureCode: SheetGenerationFailureCode }
  | { kind: "skipped" };

export type ReadSheetGenerationResult =
  | { kind: "ok"; run: SheetGenerationRun; spec: CharacterSheetSpec | null }
  | { kind: "run_not_found" }
  | { kind: "storage_unavailable" };

/**
 * Begins a character-sheet generation only when the analysis has a current
 * rules run whose canonical RulesContext is READY and domain-valid. Every id is
 * server-minted (uuid); the RulesContext is snapshotted into a temporary input
 * artifact so later stages stay self-contained.
 */
export async function beginSheetGenerationRun(
  input: { analysisId: string },
  deps: BeginSheetGenerationDeps,
): Promise<BeginSheetGenerationResult> {
  const rulesRun = await deps.rulesAnalysisRunRepository.findCurrent(
    input.analysisId,
  );
  if (rulesRun === null) {
    return { kind: "rules_context_not_ready" };
  }

  const existing = await deps.runRepository.findCurrent(input.analysisId);
  if (existing !== null && existing.status !== "FAILED") {
    return { kind: "run_already_exists", run: existing };
  }

  const now = deps.clock.now();
  const run: SheetGenerationRun = {
    runId: deps.idGenerator.uuid(),
    analysisId: input.analysisId,
    rulesAnalysisRunId: rulesRun.runId,
    ingestionId: rulesRun.ingestionId,
    status: "QUEUED",
    failureCode: null,
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
  };

  const context = await readReadyRulesContext(
    {
      analysisId: input.analysisId,
      ingestionId: run.ingestionId,
      runId: run.rulesAnalysisRunId,
    },
    deps.rulesArtifactStore,
  );
  if (context === null || !isRulesContextReady(context)) {
    return { kind: "rules_context_not_ready" };
  }

  try {
    await deps.artifactStore.putInput({
      analysisId: run.analysisId,
      runId: run.runId,
      rulesAnalysisRunId: run.rulesAnalysisRunId,
      ingestionId: run.ingestionId,
      context,
    });
  } catch {
    return { kind: "storage_unavailable" };
  }

  const created = await deps.runRepository.createCurrent(run);
  if (created === "superseded") {
    await bestEffortDeleteRunArtifacts(deps.artifactStore, {
      analysisId: run.analysisId,
      runId: run.runId,
    });
    const raced = await deps.runRepository.findCurrent(input.analysisId);
    return { kind: "run_already_exists", run: raced ?? run };
  }

  const current = await deps.runRepository.findCurrent(input.analysisId);
  return current === null || current.runId !== run.runId
    ? { kind: "run_already_exists", run: current ?? run }
    : { kind: "started", run };
}

/**
 * Generates and validates the section plan, then persists it as a versioned
 * artifact. The claim transitions the run QUEUED -> GENERATING and is CAS- and
 * triple-identity-guarded so a stale run can never advance.
 */
export async function generateSectionPlan(
  input: { analysisId: string; runId: string },
  deps: SheetGenerationStageDeps,
): Promise<SheetStageResult<SectionPlanOutput>> {
  const run = await requireActivableRun(input, deps);
  if (run === null) {
    return { kind: "skipped" };
  }
  const context = await loadContext(input, deps);
  if (context === null || !isRulesContextReady(context)) {
    return failRun(run, "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY", deps);
  }

  const system = buildSectionPlanSystemPrompt();
  const baseUser = buildSectionPlanUserPrompt({ context });
  let feedback: string | null = null;
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await deps.sheetGeneration.generate({
        stage: "section-plan",
        system,
        user:
          feedback === null
            ? baseUser
            : appendValidationFeedback(baseUser, feedback),
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_MODEL_UNAVAILABLE", deps);
    }

    const parsed = parseSectionPlan(raw);
    if (!parsed.ok) {
      feedback = parsed.error;
      continue;
    }
    const invalid = validateSectionPlanAgainstContext(parsed.plan, context);
    if (invalid !== null) {
      feedback = invalid;
      continue;
    }
    try {
      await deps.artifactStore.putSectionPlan({
        analysisId: input.analysisId,
        runId: input.runId,
        plan: parsed.plan,
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    return { kind: "ok", value: parsed.plan };
  }

  return failRun(run, "CHARACTER_SHEET_PLAN_OUTPUT_INVALID", deps);
}

/**
 * Generates and validates the fields of one section. `usedKeys` is derived
 * deterministically from every earlier section's already-persisted fields, so
 * retries and section ordering can never collide keys.
 */
export async function generateSectionFields(
  input: { analysisId: string; runId: string; sectionKey: string },
  deps: SheetGenerationStageDeps,
): Promise<SheetStageResult<FieldCandidatesOutput>> {
  const run = await requireActivableRun(input, deps);
  if (run === null) {
    return { kind: "skipped" };
  }
  const context = await loadContext(input, deps);
  if (context === null || !isRulesContextReady(context)) {
    return failRun(run, "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY", deps);
  }

  let plan;
  try {
    const artifact = await deps.artifactStore.getSectionPlan(input);
    if (artifact === null) {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    plan = artifact.plan;
  } catch {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }

  const sectionIndex = plan.sections.findIndex(
    (section) => section.key === input.sectionKey,
  );
  const section = plan.sections[sectionIndex];
  if (section === undefined) {
    return { kind: "skipped" };
  }

  const usedFields = await collectUsedKeys(
    { analysisId: input.analysisId, runId: input.runId },
    plan,
    sectionIndex,
    deps,
  );
  if (usedFields === null) {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }
  const usedKeys = usedFields.map((entry) => entry.key);

  const system = buildFieldSystemPrompt();
  const baseUser = buildFieldUserPrompt({ context, section, usedKeys });
  let feedback: string | null = null;
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await deps.sheetGeneration.generate({
        stage: "field-candidates",
        system,
        user:
          feedback === null
            ? baseUser
            : appendValidationFeedback(baseUser, feedback),
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_MODEL_UNAVAILABLE", deps);
    }

    const parsed = parseFieldCandidates(raw);
    if (!parsed.ok) {
      feedback = parsed.error;
      continue;
    }
    const invalid = validateFieldCandidatesAgainstContext(
      parsed.fields.fields,
      context,
      new Set(usedKeys),
      new Map(usedFields.map((entry) => [entry.key, entry.type])),
    );
    if (invalid !== null) {
      feedback = invalid;
      continue;
    }
    try {
      await deps.artifactStore.putSectionFields({
        analysisId: input.analysisId,
        runId: input.runId,
        sectionKey: input.sectionKey,
        fields: parsed.fields.fields,
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    return { kind: "ok", value: parsed.fields };
  }

  return failRun(run, "CHARACTER_SHEET_FIELDS_OUTPUT_INVALID", deps);
}

/**
 * Generates calculations only when the compiled field index actually contains
 * calculated fields; otherwise it persists an empty calculations artifact so
 * the compile step stays uniform. Every candidate key must match a calculated
 * field and every expression reference must resolve to a real field key.
 */
export async function generateSheetCalculations(
  input: { analysisId: string; runId: string },
  deps: SheetGenerationStageDeps,
): Promise<SheetStageResult<readonly CalculationCandidate[]>> {
  const run = await requireActivableRun(input, deps);
  if (run === null) {
    return { kind: "skipped" };
  }
  const context = await loadContext(input, deps);
  if (context === null || !isRulesContextReady(context)) {
    return failRun(run, "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY", deps);
  }

  let plan;
  let collected;
  try {
    const planArtifact = await deps.artifactStore.getSectionPlan(input);
    if (planArtifact === null) {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    plan = planArtifact.plan;
    collected = await collectSectionFields(input, plan, deps);
  } catch {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }
  if (collected === null) {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }

  const sectionOrder = new Map(
    plan.sections.map((section, index) => [section.key, index]),
  );
  const fieldIndex: readonly CalculationFieldIndexEntry[] = collected.flatMap(
    ([sectionKey, fields]) =>
      fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        sectionKey,
        sectionOrder: sectionOrder.get(sectionKey) ?? 0,
      })),
  );
  const calculatedKeys = fieldIndex
    .filter((entry) => entry.type === "calculated")
    .map((entry) => entry.key);

  if (calculatedKeys.length === 0) {
    try {
      await deps.artifactStore.putCalculations({
        analysisId: input.analysisId,
        runId: input.runId,
        calculations: [],
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    return { kind: "ok", value: [] };
  }

  const system = buildCalculationSystemPrompt();
  const baseUser = buildCalculationUserPrompt({
    context,
    calculatedKeys,
    fieldIndex,
  });
  let feedback: string | null = null;
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await deps.sheetGeneration.generate({
        stage: "calculations",
        system,
        user:
          feedback === null
            ? baseUser
            : appendValidationFeedback(baseUser, feedback),
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_MODEL_UNAVAILABLE", deps);
    }

    const parsed = parseCalculationCandidates(raw);
    if (!parsed.ok) {
      feedback = parsed.error;
      continue;
    }
    const invalid = validateCalculationCandidatesAgainstContext(
      parsed.calculations.calculations,
      fieldIndex,
    );
    if (invalid !== null) {
      feedback = invalid;
      continue;
    }
    try {
      await deps.artifactStore.putCalculations({
        analysisId: input.analysisId,
        runId: input.runId,
        calculations: parsed.calculations.calculations,
      });
    } catch {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    return { kind: "ok", value: parsed.calculations.calculations };
  }

  return failRun(run, "CHARACTER_SHEET_CALCULATIONS_OUTPUT_INVALID", deps);
}

/**
 * Compiles the deterministic canonical spec and persists it before finalizing
 * the run. The COMPILING claim prevents a stale run from flipping a superseded
 * generation READY.
 */
export async function compileSheetGeneration(
  input: { analysisId: string; runId: string },
  deps: SheetGenerationStageDeps,
): Promise<SheetStageResult<CharacterSheetSpec>> {
  const run = await deps.runRepository.findRun(input.analysisId, input.runId);
  if (run === null || !run.isCurrent) {
    return { kind: "skipped" };
  }
  const claimed = await deps.runRepository.claimCompilingIfCurrent(input.runId);
  if (!claimed) {
    return { kind: "skipped" };
  }

  let context: RulesContext;
  let plan: SectionPlanOutput;
  let collected;
  let calculations: readonly CalculationCandidate[];
  try {
    const inputArtifact = await deps.artifactStore.getInput(input);
    if (inputArtifact === null) {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    context = inputArtifact.context;
    const planArtifact = await deps.artifactStore.getSectionPlan(input);
    if (planArtifact === null) {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    plan = planArtifact.plan;
    collected = await collectSectionFields(input, plan, deps);
    const calcArtifact = await deps.artifactStore.getCalculations(input);
    if (calcArtifact === null) {
      return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
    }
    calculations = calcArtifact.calculations;
  } catch {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }
  if (collected === null) {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }
  if (!isRulesContextReady(context)) {
    return failRun(run, "CHARACTER_SHEET_RULES_CONTEXT_NOT_READY", deps);
  }

  const fieldsBySection = new Map<string, readonly FieldCandidate[]>();
  for (const [sectionKey, fields] of collected) {
    fieldsBySection.set(sectionKey, fields);
  }

  let spec: CharacterSheetSpec;
  try {
    spec = compileCharacterSheet({
      context,
      plan,
      fieldsBySection,
      calculations,
    });
  } catch (error) {
    if (
      error instanceof SheetCompileError &&
      error.reason === "candidate_invalid"
    ) {
      return failRun(run, "CHARACTER_SHEET_DOMAIN_INVALID", deps);
    }
    return failRun(run, "CHARACTER_SHEET_COMPILE_FAILED", deps);
  }

  const domain = validateCharacterSheetSpecDomain(spec, context);
  if (!domain.valid) {
    return failRun(run, "CHARACTER_SHEET_DOMAIN_INVALID", deps);
  }
  const parsed = CharacterSheetSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return failRun(run, "CHARACTER_SHEET_COMPILE_FAILED", deps);
  }

  try {
    await deps.artifactStore.putSpec({
      analysisId: input.analysisId,
      runId: input.runId,
      spec: parsed.data,
    });
  } catch {
    return failRun(run, "CHARACTER_SHEET_STORAGE_UNAVAILABLE", deps);
  }

  const finalized = await deps.runRepository.finalizeReadyIfCurrent(
    input.runId,
  );
  return finalized ? { kind: "ok", value: parsed.data } : { kind: "skipped" };
}

export async function readSheetGenerationRun(
  input: { analysisId: string },
  deps: {
    runRepository: SheetGenerationRunRepositoryPort;
    artifactStore: SheetArtifactPort;
  },
): Promise<ReadSheetGenerationResult> {
  const run = await deps.runRepository.findCurrent(input.analysisId);
  if (run === null) {
    return { kind: "run_not_found" };
  }
  if (run.status !== "READY") {
    return { kind: "ok", run, spec: null };
  }
  try {
    const spec = await deps.artifactStore.getSpec({
      analysisId: input.analysisId,
      runId: run.runId,
    });
    return spec === null
      ? { kind: "storage_unavailable" }
      : { kind: "ok", run, spec };
  } catch {
    return { kind: "storage_unavailable" };
  }
}

/**
 * Invalidates every non-terminal sheet generation of an analysis (authoritative
 * D1 transition) and best-effort deletes its temporary artifacts. Used when the
 * RulesContext source is removed or a fresh generation supersedes it.
 */
export async function invalidateSheetGenerations(
  input: { analysisId: string },
  deps: {
    runRepository: SheetGenerationRunRepositoryPort;
    artifactStore: SheetArtifactPort;
  },
): Promise<{ invalidated: number }> {
  const runs = await deps.runRepository.invalidateSheetsForAnalysis(
    input.analysisId,
  );
  for (const run of runs) {
    await bestEffortDeleteRunArtifacts(deps.artifactStore, {
      analysisId: input.analysisId,
      runId: run.runId,
    });
  }
  return { invalidated: runs.length };
}

async function readReadyRulesContext(
  input: { analysisId: string; ingestionId: string; runId: string },
  rulesArtifactStore: RunArtifactPort,
): Promise<RulesContext | null> {
  let context: RulesContext | null;
  try {
    context = await rulesArtifactStore.getContext(input);
  } catch {
    return null;
  }
  return context;
}

function isRulesContextReady(context: RulesContext): boolean {
  if (context.status !== "ready") {
    return false;
  }
  return validateRulesContextDomain(context).valid;
}

async function requireActivableRun(
  input: { analysisId: string; runId: string },
  deps: SheetGenerationStageDeps,
): Promise<SheetGenerationRun | null> {
  const run = await deps.runRepository.findRun(input.analysisId, input.runId);
  if (run === null || !run.isCurrent) {
    return null;
  }
  if (
    run.status === "FAILED" ||
    run.status === "INVALIDATED" ||
    run.status === "READY"
  ) {
    return null;
  }
  const claimed = await deps.runRepository.claimGeneratingIfCurrent(
    input.runId,
    input.analysisId,
    run.rulesAnalysisRunId,
    run.ingestionId,
  );
  return claimed === "claimed" ? run : null;
}

async function loadContext(
  input: { analysisId: string; runId: string },
  deps: SheetGenerationStageDeps,
): Promise<RulesContext | null> {
  try {
    const artifact = await deps.artifactStore.getInput(input);
    return artifact === null ? null : artifact.context;
  } catch {
    return null;
  }
}

async function collectUsedKeys(
  input: { analysisId: string; runId: string },
  plan: SectionPlanOutput,
  sectionIndex: number,
  deps: SheetGenerationStageDeps,
): Promise<readonly { key: string; type: FieldCandidate["type"] }[] | null> {
  const keys: { key: string; type: FieldCandidate["type"] }[] = [];
  for (let index = 0; index < sectionIndex; index += 1) {
    const sectionKey = plan.sections[index]?.key;
    if (sectionKey === undefined) {
      continue;
    }
    const artifact = await deps.artifactStore.getSectionFields({
      ...input,
      sectionKey,
    });
    if (artifact === null) {
      return null;
    }
    for (const field of artifact.fields) {
      keys.push({ key: field.key, type: field.type });
    }
  }
  return keys;
}

async function collectSectionFields(
  input: { analysisId: string; runId: string },
  plan: SectionPlanOutput,
  deps: SheetGenerationStageDeps,
): Promise<readonly [string, readonly FieldCandidate[]][] | null> {
  const collected: [string, readonly FieldCandidate[]][] = [];
  for (const section of plan.sections) {
    const artifact = await deps.artifactStore.getSectionFields({
      ...input,
      sectionKey: section.key,
    });
    if (artifact === null) {
      return null;
    }
    collected.push([section.key, artifact.fields]);
  }
  return collected;
}

async function failRun(
  run: SheetGenerationRun,
  failureCode: SheetGenerationFailureCode,
  deps: SheetGenerationStageDeps,
): Promise<{ kind: "failed"; failureCode: SheetGenerationFailureCode }> {
  await deps.runRepository.markFailedIfCurrent(
    run.runId,
    failureCode,
    deps.clock.now(),
  );
  return { kind: "failed", failureCode };
}

async function bestEffortDeleteRunArtifacts(
  artifactStore: SheetArtifactPort,
  input: { analysisId: string; runId: string },
): Promise<void> {
  try {
    await artifactStore.deleteRunArtifacts(input);
  } catch {
    // Best-effort housekeeping; the D1 row state remains authoritative.
  }
}
