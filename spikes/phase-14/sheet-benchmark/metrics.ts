import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
} from "@repo/character-sheet-schema";
import type { FieldCandidate } from "@repo/character-sheet-generation";
import {
  taxonomyFromFailureCode,
  type FailureTaxonomy,
  type FixtureRunResult,
  type SheetGenerationCallRecord,
} from "./harness.js";
import { type SheetBenchmarkFixture } from "./fixtures.js";
import {
  evaluateLocaleFromText,
  type LocaleVerdict as DriftLocaleVerdict,
} from "./drift-diagnostics.js";

export interface AcceptanceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface AcceptanceReport {
  readonly passed: boolean;
  readonly checks: readonly AcceptanceCheck[];
  readonly taxonomy: FailureTaxonomy | null;
}

function collectSpecText(result: FixtureRunResult): string {
  const spec = result.spec;
  if (spec === null) {
    return "";
  }
  const parts: string[] = [];
  for (const section of spec.sections) {
    parts.push(section.title);
  }
  for (const field of spec.fields) {
    parts.push(field.label);
    if (
      field.type === "radio" ||
      field.type === "select" ||
      field.type === "multiselect"
    ) {
      for (const option of field.options) {
        parts.push(option.label);
      }
    }
    if (field.type === "table") {
      for (const column of field.columns) {
        parts.push(column.label);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

function collectRawOutputs(result: FixtureRunResult): string {
  return result.calls
    .map((call) => call.raw)
    .join(" ")
    .toLowerCase();
}

function collectCitedRuleIds(result: FixtureRunResult): Set<string> {
  const cited = new Set<string>();
  for (const section of result.plan?.sections ?? []) {
    for (const ruleId of section.ruleIds) {
      cited.add(ruleId);
    }
  }
  for (const sectionFields of result.fieldsBySection) {
    for (const field of sectionFields.fields) {
      for (const ruleId of field.ruleIds) {
        cited.add(ruleId);
      }
    }
  }
  for (const calculation of result.calculations) {
    for (const ruleId of calculation.ruleIds) {
      cited.add(ruleId);
    }
  }
  return cited;
}

function knownRuleIds(fixture: SheetBenchmarkFixture): Set<string> {
  return new Set(fixture.context.normalizedRules.map((rule) => rule.id));
}

/**
 * Binary acceptance gate. A fixture passes only when every invariant holds:
 * all pipeline stages succeeded, the compiled spec parses, is domain-valid,
 * covers every required concept, cites every required rule, never cites an
 * unknown rule, never contains forbidden/fabricated terms (adversarial
 * injection marker included), and produces exactly the expected number of
 * calculated fields. One generated correction replay is already allowed inside
 * the production stage loop; there is no manual repair path here.
 */
export function evaluateFixtureAcceptance(
  fixture: SheetBenchmarkFixture,
  result: FixtureRunResult,
): AcceptanceReport {
  const checks: AcceptanceCheck[] = [];

  const failedStages = result.stageResults.filter(
    (stage) => stage.kind !== "ok",
  );
  checks.push({
    name: "all pipeline stages succeeded",
    passed: failedStages.length === 0,
    details:
      failedStages.length === 0
        ? `${result.stageResults.length} stages ok`
        : failedStages
            .map(
              (stage) =>
                `${stage.stage} -> ${stage.kind} (${stage.failureCode ?? "no code"})`,
            )
            .join("; "),
  });

  const schema =
    result.spec === null
      ? null
      : CharacterSheetSpecSchema.safeParse(result.spec);
  checks.push({
    name: "compiled spec parses",
    passed: schema !== null && schema.success,
    details:
      schema === null
        ? "no spec produced"
        : schema.success
          ? "ok"
          : schema.error.message,
  });

  const domain =
    result.spec === null
      ? null
      : validateCharacterSheetSpecDomain(result.spec, fixture.context);
  checks.push({
    name: "compiled spec is domain-valid",
    passed: domain !== null && domain.valid,
    details:
      domain === null
        ? result.compileDiagnostics === null
          ? "no spec produced"
          : result.compileDiagnostics.domainIssues.length > 0
            ? `no spec produced; ${result.compileDiagnostics.domainIssues
                .slice(0, 6)
                .join("; ")}`
            : `no spec produced; ${
                result.compileDiagnostics.compilerError ??
                result.compileDiagnostics.schemaError ??
                "compile-stage failure"
              }`
        : domain.valid
          ? "ok"
          : domain.issues
              .slice(0, 6)
              .map((issue) => `${issue.code}@${issue.path.join(".")}`)
              .join("; "),
  });

  const specText = collectSpecText(result);
  const rawOutput = collectRawOutputs(result);
  const covered: string[] = [];
  const missing: { group: string; terms: string }[] = [];
  for (const group of fixture.requiredConceptGroups) {
    const hit = group.find((term) => specText.includes(term.toLowerCase()));
    if (hit !== undefined) {
      covered.push(hit);
    } else {
      missing.push({ group: group.join(" / "), terms: group.join(" | ") });
    }
  }
  checks.push({
    name: "required concepts covered",
    passed: missing.length === 0,
    details:
      missing.length === 0
        ? covered.join(", ")
        : `missing: ${missing.map((item) => item.group).join("; ")}`,
  });

  const cited = collectCitedRuleIds(result);
  const uncited = fixture.requiredRuleIds.filter(
    (ruleId) => !cited.has(ruleId),
  );
  checks.push({
    name: "required rules cited",
    passed: uncited.length === 0,
    details:
      uncited.length === 0
        ? fixture.requiredRuleIds.join(", ")
        : `uncited: ${uncited.join(", ")}`,
  });

  const known = knownRuleIds(fixture);
  const unknown: string[] = [];
  for (const ruleId of cited) {
    if (!known.has(ruleId)) {
      unknown.push(ruleId);
    }
  }
  checks.push({
    name: "no fabricated or unknown rule ids",
    passed: unknown.length === 0,
    details:
      unknown.length === 0
        ? `${cited.size} distinct rule ids all known`
        : `unknown: ${unknown.join(", ")}`,
  });

  const forbiddenSeen = fixture.mustNotContain.filter(
    (term) =>
      specText.includes(term.toLowerCase()) ||
      rawOutput.includes(term.toLowerCase()),
  );
  checks.push({
    name: "no forbidden or injected terms in output",
    passed: forbiddenSeen.length === 0,
    details:
      forbiddenSeen.length === 0
        ? "clean"
        : `found: ${forbiddenSeen.join(", ")}`,
  });

  const calculatedCount =
    result.spec?.fields.filter((field) => field.type === "calculated").length ??
    0;
  checks.push({
    name: "expected calculated-field count",
    passed: calculatedCount === fixture.expectedCalculatedCount,
    details: `expected ${fixture.expectedCalculatedCount}, got ${calculatedCount}`,
  });

  const passed = checks.every((check) => check.passed);
  const failedAtStage = result.stageResults.filter(
    (stage) => stage.kind !== "ok",
  );
  const taxonomy: FailureTaxonomy | null = !passed
    ? failedAtStage.length > 0
      ? (failedAtStage[0]?.diagnostic?.taxonomy ??
        taxonomyFromFailureCode(failedAtStage[0]?.failureCode ?? null) ??
        "acceptance_coverage")
      : "acceptance_coverage"
    : null;

  return { passed, checks, taxonomy };
}

export interface StageLatency {
  readonly stage: string;
  readonly count: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly maxMs: number;
}

export interface LocaleVerdict {
  readonly fixtureId: string;
  readonly expected: "en" | "es";
  readonly detected: "en" | "es" | null;
  readonly verdict: "satisfied" | "wrong_locale" | "mixed" | "insufficient";
  readonly matches: { readonly en: number; readonly es: number };
}

export interface ModelBenchmarkMetrics {
  readonly model: string;
  readonly fixturesAttempted: number;
  readonly fixturesPassed: number;
  readonly passRate: number;
  readonly totalCalls: number;
  readonly plannedCalls: number;
  readonly firstAttempts: number;
  readonly correctionReplays: number;
  readonly correctionSuccesses: number;
  readonly correctionFailures: number;
  readonly perStageAttempts: readonly AttemptStageRollup[];
  /** Legacy field kept for continuity; always equals firstAttempts. */
  readonly nominalCalls: number;
  /** Legacy field kept for continuity; always equals correctionReplays. */
  readonly retryCalls: number;
  readonly perStage: readonly StageLatency[];
  readonly totalElapsedMs: number;
  readonly localeVerdicts: readonly LocaleVerdict[];
}

export interface AttemptStageRollup {
  readonly stage: string;
  readonly firstAttempts: number;
  readonly replays: number;
  readonly successReplays: number;
  readonly failedReplays: number;
}

export interface AttemptOutcomes {
  readonly firstAttempts: number;
  readonly replays: number;
  readonly successReplays: number;
  readonly failedReplays: number;
  readonly perStage: readonly AttemptStageRollup[];
}

/**
 * Extracts exactly the display content the model generated (plan titles and
 * field/option/column labels). Rule text is fixture-supplied, not generated, so
 * it is never used as locale evidence; keys are opaque identifiers.
 */
function collectGeneratedDisplayText(result: FixtureRunResult): string {
  const parts: string[] = [];
  for (const section of result.plan?.sections ?? []) {
    parts.push(section.title);
  }
  for (const entry of result.fieldsBySection) {
    for (const field of entry.fields) {
      parts.push(field.label);
      if (
        field.type === "radio" ||
        field.type === "select" ||
        field.type === "multiselect"
      ) {
        for (const option of field.options) {
          parts.push(option.label);
        }
      }
      if (field.type === "table") {
        for (const column of field.columns) {
          parts.push(column.label);
        }
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Verdict over the generated display content against the fixture-declared
 * expected language. Delegates to the shared drift-diagnostics evaluator
 * to keep locale word lists in a single authoritative location.
 */
export function evaluateGeneratedLocale(
  result: FixtureRunResult,
  expected: "en" | "es",
): LocaleVerdict {
  const text = collectGeneratedDisplayText(result);
  const driftVerdict = evaluateLocaleFromText(text, expected);
  return {
    fixtureId: result.fixtureId,
    expected: driftVerdict.expected,
    detected: driftVerdict.detected,
    verdict: driftVerdict.verdict,
    matches: driftVerdict.matches,
  };
}

/**
 * Resolves attempt metadata from the recorded calls, slot by slot. A slot's
 * committed output is its last call when the matching stage (`fields:<key>`,
 * `section-plan`, or `calculations`) succeeded; every recorded replay that did
 * not become the committed output is a correction failure. This replaces the
 * old `totalCalls - nominalCalls` guess, which early aborts deflated and
 * mid-pipeline replays inflated.
 */
export function resolveAttemptOutcomes(
  result: FixtureRunResult,
): AttemptOutcomes {
  const bySlot = new Map<string, SheetGenerationCallRecord[]>();
  for (const call of result.calls) {
    const list = bySlot.get(call.slot) ?? [];
    list.push(call);
    bySlot.set(call.slot, list);
  }

  const perStage = new Map<string, AttemptStageRollup>();
  let firstAttempts = 0;
  let replays = 0;
  let successReplays = 0;
  let failedReplays = 0;

  for (const [slot, calls] of bySlot) {
    const stageName = slot.startsWith("field-candidates:")
      ? `fields:${slot.slice("field-candidates:".length)}`
      : slot;
    const baseStage = slot.startsWith("field-candidates:")
      ? "field-candidates"
      : slot;
    const slotFirsts = calls.filter((call) => !call.isCorrectionReplay).length;
    const slotReplays = calls.filter((call) => call.isCorrectionReplay).length;
    const committed =
      result.stageResults.find(
        (stage) => stage.stage === stageName && stage.kind === "ok",
      ) !== undefined;
    const slotSuccess = committed ? slotReplays : 0;
    const slotFailed = slotReplays - slotSuccess;

    firstAttempts += slotFirsts;
    replays += slotReplays;
    successReplays += slotSuccess;
    failedReplays += slotFailed;

    const aggregate = perStage.get(baseStage) ?? {
      stage: baseStage,
      firstAttempts: 0,
      replays: 0,
      successReplays: 0,
      failedReplays: 0,
    };
    perStage.set(baseStage, {
      stage: baseStage,
      firstAttempts: aggregate.firstAttempts + slotFirsts,
      replays: aggregate.replays + slotReplays,
      successReplays: aggregate.successReplays + slotSuccess,
      failedReplays: aggregate.failedReplays + slotFailed,
    });
  }

  return {
    firstAttempts,
    replays,
    successReplays,
    failedReplays,
    perStage: [...perStage.values()],
  };
}

/**
 * Aggregates a single model's run over all fixtures into reportable metrics.
 * `nominalCalls` assumes one attempt per stage and a calculations call only when
 * the fixture expects at least one calculated field; the difference between
 * actual and nominal calls is the correction-replay overhead.
 */
export function computeModelMetrics(
  model: string,
  results: readonly FixtureRunResult[],
  fixtures: readonly SheetBenchmarkFixture[],
): ModelBenchmarkMetrics {
  const byFixture = new Map(
    results.map((result) => [result.fixtureId, result]),
  );
  const perStage = new Map<
    string,
    { count: number; totalMs: number; maxMs: number }
  >();
  const attemptsByStage = new Map<string, AttemptStageRollup>();
  const localeVerdicts: LocaleVerdict[] = [];
  let totalCalls = 0;
  let plannedCalls = 0;
  let firstAttempts = 0;
  let correctionReplays = 0;
  let correctionSuccesses = 0;
  let correctionFailures = 0;
  let fixturesPassed = 0;

  for (const fixture of fixtures) {
    const result = byFixture.get(fixture.id);
    if (result === undefined) {
      continue;
    }
    const acceptance = evaluateFixtureAcceptance(fixture, result);
    if (acceptance.passed) {
      fixturesPassed += 1;
    }
    localeVerdicts.push(evaluateGeneratedLocale(result, fixture.language));
    const expectedSections = result.plan?.sections.length ?? 0;
    const expectsCalculations = fixture.expectedCalculatedCount > 0;
    plannedCalls += 1 + expectedSections + (expectsCalculations ? 1 : 0);

    const outcomes = resolveAttemptOutcomes(result);
    firstAttempts += outcomes.firstAttempts;
    correctionReplays += outcomes.replays;
    correctionSuccesses += outcomes.successReplays;
    correctionFailures += outcomes.failedReplays;
    for (const rollup of outcomes.perStage) {
      const aggregate = attemptsByStage.get(rollup.stage) ?? {
        stage: rollup.stage,
        firstAttempts: 0,
        replays: 0,
        successReplays: 0,
        failedReplays: 0,
      };
      attemptsByStage.set(rollup.stage, {
        stage: rollup.stage,
        firstAttempts: aggregate.firstAttempts + rollup.firstAttempts,
        replays: aggregate.replays + rollup.replays,
        successReplays: aggregate.successReplays + rollup.successReplays,
        failedReplays: aggregate.failedReplays + rollup.failedReplays,
      });
    }

    totalCalls += result.calls.length;
    for (const call of result.calls) {
      const bucket = perStage.get(call.stage) ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };
      bucket.count += 1;
      bucket.totalMs += call.elapsedMs;
      bucket.maxMs = Math.max(bucket.maxMs, call.elapsedMs);
      perStage.set(call.stage, bucket);
    }
  }

  const attempted = fixtures.length;
  const totalElapsedMs = results
    .flatMap((result) => result.calls)
    .reduce((sum, call) => sum + call.elapsedMs, 0);

  return {
    model,
    fixturesAttempted: attempted,
    fixturesPassed,
    passRate: attempted === 0 ? 0 : fixturesPassed / attempted,
    totalCalls,
    plannedCalls,
    firstAttempts,
    correctionReplays,
    correctionSuccesses,
    correctionFailures,
    perStageAttempts: [...attemptsByStage.values()],
    nominalCalls: firstAttempts,
    retryCalls: correctionReplays,
    perStage: [...perStage.entries()].map(([stage, bucket]) => ({
      stage,
      count: bucket.count,
      totalMs: round(bucket.totalMs),
      meanMs: round(bucket.totalMs / bucket.count),
      maxMs: round(bucket.maxMs),
    })),
    totalElapsedMs: round(totalElapsedMs),
    localeVerdicts,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
