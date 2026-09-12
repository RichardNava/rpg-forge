import { AUTHORIZED_MODEL, EXTRACTION_VALIDATION_NAME } from "./config.js";
import type { ExtractionValidationFixture } from "./fixtures.js";
import { FAILURE_CLASS_LABELS } from "./classify.js";
import { signatureOpToken } from "./signatures.js";
import type { FixtureEvaluation } from "./scoring.js";

export type OverallClass = "A" | "B" | "C" | "D";

export const CLOSING_PHRASES: Record<OverallClass, string> = {
  A: "PHASE 14.5 2C2B REMOTE VALIDATION COMPLETE — EXTRACTION CONTRACT VALIDATED",
  B: "PHASE 14.5 2C2B REMOTE VALIDATION COMPLETE — PARTIAL REFINEMENT REQUIRED",
  C: "PHASE 14.5 2C2B REMOTE VALIDATION COMPLETE — MODEL FAILED CRITICAL SEMANTICS",
  D: "PHASE 14.5 2C2B REMOTE VALIDATION BLOCKED — WORKERS AI QUOTA/PROVIDER",
};

export interface RunAggregate {
  readonly attempted: number;
  readonly passed: number;
  readonly criticalPassed: number;
  readonly criticalAttempted: number;
  readonly failureClassCounts: Record<
    "A" | "B" | "C" | "D" | "E" | "F",
    number
  >;
  readonly replayUsedCount: number;
  readonly recoveredOnReplayCount: number;
  readonly totalCalls: number;
  readonly totalLatencyMs: number;
  readonly totalOutputTokens: number;
}

const ZERO_CLASS_COUNTS: RunAggregate["failureClassCounts"] = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  E: 0,
  F: 0,
};

export function computeAggregate(
  evaluations: readonly FixtureEvaluation[],
): RunAggregate {
  const failureClassCounts = { ...ZERO_CLASS_COUNTS };
  let passed = 0;
  let criticalPassed = 0;
  let criticalAttempted = 0;
  let replayUsedCount = 0;
  let recoveredOnReplayCount = 0;
  let totalCalls = 0;
  let totalLatencyMs = 0;
  let totalOutputTokens = 0;

  for (const evaluation of evaluations) {
    if (evaluation.passed) {
      passed += 1;
    }
    if (evaluation.critical) {
      criticalAttempted += 1;
      if (evaluation.passed) {
        criticalPassed += 1;
      }
    }
    if (evaluation.classification !== "PASS") {
      failureClassCounts[evaluation.classification] += 1;
    }
    if (evaluation.checks.replayUsed) {
      replayUsedCount += 1;
    }
    if (evaluation.checks.recoveredOnReplay) {
      recoveredOnReplayCount += 1;
    }
    totalCalls += evaluation.calls.length;
    totalLatencyMs += evaluation.totalElapsedMs;
    for (const call of evaluation.calls) {
      const tokens = usageTokens(call.usage);
      if (tokens !== null) {
        totalOutputTokens += tokens;
      }
    }
  }
  return {
    attempted: evaluations.length,
    passed,
    criticalPassed,
    criticalAttempted,
    failureClassCounts,
    replayUsedCount,
    recoveredOnReplayCount,
    totalCalls,
    totalLatencyMs,
    totalOutputTokens,
  };
}

function usageTokens(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) {
    return null;
  }
  const record = usage as Record<string, unknown>;
  for (const key of [
    "output_tokens",
    "total_tokens",
    "outputTokens",
    "totalTokens",
  ]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Overall run classification:
 *  A all critical fixtures pass, no model-feasible defect blocks the contract;
 *  B criticals pass but non-critical semantic/structured failures occurred;
 *  C at least one critical fixture failed a model-feasible check;
 *  D the run itself was blocked (quota/provider/wrangler).
 */
export function classifyOverall(
  evaluations: readonly FixtureEvaluation[],
  blocked: boolean,
): OverallClass {
  if (blocked) {
    return "D";
  }
  const failing = evaluations.filter((evaluation) => !evaluation.passed);
  const criticalFailing = failing.filter((evaluation) => evaluation.critical);
  if (criticalFailing.length > 0) {
    return "C";
  }
  return failing.length === 0 ? "A" : "B";
}

export interface ExtractionReportInputs {
  readonly filesChanged: readonly string[];
  readonly command: string;
  readonly fixtureIdFilter: string | null;
  readonly evaluations: readonly FixtureEvaluation[];
  readonly aggregate: RunAggregate;
  readonly overall: OverallClass;
  readonly blockedMessage: string | null;
  readonly sheetGenerationModel: string | null;
  readonly gitStatusShort: string;
  readonly resultsDir: string;
  readonly runId: string;
}

export function renderMarkdownReport(
  inputs: ExtractionReportInputs,
  fixtures: readonly ExtractionValidationFixture[],
): string {
  const lines: string[] = [];
  lines.push(`# ${EXTRACTION_VALIDATION_NAME}`);
  lines.push("");
  lines.push(`Run: ${new Date().toISOString()} | runId: ${inputs.runId}`);
  lines.push(`Results directory: ${inputs.resultsDir}`);
  lines.push("");
  lines.push(`## 1. Files changed`);
  lines.push("");
  for (const file of inputs.filesChanged) {
    lines.push(`- ${file}`);
  }
  lines.push("");
  lines.push(`## 2. Command executed`);
  lines.push("");
  lines.push(`\`${inputs.command}\``);
  lines.push("");
  lines.push(`## 3. Resolved experiment matrix`);
  lines.push("");
  lines.push(
    `1 model x ${fixtures.length} fixtures${
      inputs.fixtureIdFilter !== null
        ? ` (narrowed to fixture ${inputs.fixtureIdFilter})`
        : ""
    }.`,
  );
  lines.push(`- model: ${AUTHORIZED_MODEL}`);
  lines.push(`- fixtures: ${fixtures.map((fixture) => fixture.id).join(", ")}`);
  lines.push("");
  lines.push(`## 4. Model`);
  lines.push("");
  lines.push(
    `\`${AUTHORIZED_MODEL}\` (pinned; no model from environment or config).`,
  );
  lines.push("");
  lines.push(`## 5. Fixture-by-fixture results`);
  lines.push("");
  lines.push(
    "| id | mode | lang | expected ops | attempts | replay | outcome | checks | class |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const fixture of fixtures) {
    const evaluation = evaluationsById(inputs.evaluations).get(fixture.id);
    if (evaluation === undefined) {
      lines.push(
        `| ${fixture.id} | ${fixture.mode} | ${fixture.language} | (not run) | - | - | - | - | - |`,
      );
      continue;
    }
    const attemptedOps = evaluation.finalSignatures
      .map(signatureOpToken)
      .join(", ");
    const expectedOps = fixture.expected.map(signatureOpToken).join(", ");
    const checks = evaluation.passed ? "all" : failedChecksSummary(evaluation);
    lines.push(
      `| ${fixture.id} | ${fixture.mode} | ${fixture.language} | ${expectedOps} | ` +
        `${evaluation.calls.length} | ${evaluation.checks.replayUsed ? "yes" : "no"} | ` +
        `${evaluation.outcomeKind} | ${checks} | ${evaluation.classification} | ` +
        `(actual: ${attemptedOps || "[]"}) |`,
    );
  }
  lines.push("");
  lines.push(`## 6. Critical fixture summary`);
  lines.push("");
  lines.push(
    `Critical set: ${inputs.aggregate.criticalPassed}/${inputs.aggregate.criticalAttempted} passed ` +
      `(F1 F2 F6 F8 F10 F11 F12).`,
  );
  lines.push("");
  lines.push(`## 7. ADD-vs-REPLACE result`);
  lines.push("");
  lines.push(
    ...criticalNarrative(
      inputs,
      "F1",
      "F2",
      'F1 ("Add Vigor") must emit exactly ADD Vigor; F2 ("Replace Constitution with Vigor") must emit exactly REPLACE Constitution->Vigor. ADD must not become REPLACE and REPLACE must not become ADD.',
    ),
  );
  lines.push("");
  lines.push(`## 8. Qualitative-vs-numeric result`);
  lines.push("");
  lines.push(
    ...criticalNarrative(
      inputs,
      "F6",
      "F5",
      'F6 ("Make him very strong") must emit no SET_VALUE/CONSTRAIN; F5 ("Strength cannot exceed 18") must emit exactly CONSTRAIN max=18.',
    ),
  );
  lines.push("");
  lines.push(`## 9. Ambiguous-replacement result`);
  lines.push("");
  lines.push(
    ...criticalNarrative(
      inputs,
      "F10",
      null,
      'F10 ("Use Vigor instead" with no source) must not fabricate a REPLACE; an empty proposal list (optionally with a target-not-actionable diagnostic) is the only accepted result.',
    ),
  );
  lines.push("");
  lines.push(`## 10. NPC portrait gating result`);
  lines.push("");
  lines.push(
    ...criticalNarrative(
      inputs,
      "F8",
      "F9",
      "F8 (NPC portrait request) must keep the explicit visual details; F9 (PC sheet with a portrait request) must show no portrait in the final gated result (deterministic app-side gating is accepted).",
    ),
  );
  lines.push("");
  lines.push(`## 11. Spanish fixture result`);
  lines.push("");
  lines.push(
    ...singleNarrative(
      inputs,
      "F12",
      'Spanish "Sustituye Constitución por Vigor [...]" must emit REPLACE Constitución->Vigor, SET_VALUE Vigor=15, name Gruk in order, preserving the accented source label.',
    ),
  );
  lines.push("");
  lines.push(`## 12. Mixed-order result`);
  lines.push("");
  lines.push(
    ...singleNarrative(
      inputs,
      "F11",
      'Mixed "Replace Constitution with Vigor, set Vigor to 15, name the character Gruk, and add an image of a large blue troll" must preserve the exact stated order.',
    ),
  );
  lines.push("");
  lines.push(...replayReliabilitySection(inputs));
  lines.push("");
  lines.push(...latencySection(inputs.aggregate, inputs.evaluations));
  lines.push("");
  lines.push(...failureTaxonomySection(inputs.aggregate));
  lines.push("");
  lines.push(`## 16. Overall A/B/C/D classification`);
  lines.push("");
  lines.push(
    `Overall: **${inputs.overall}** — ${CLOSING_PHRASES[inputs.overall]}`,
  );
  lines.push("");
  lines.push(`## 17. Prompt/schema change recommendation`);
  lines.push("");
  lines.push(promptRecommendation(inputs.overall, inputs.aggregate));
  lines.push("");
  lines.push(`## 18. No-production-integration confirmation`);
  lines.push("");
  lines.push(
    "No production package, provider adapter, workflow, route, D1/R2 resource or " +
      "live-generation wiring was changed by this iteration. The experiment lives " +
      "entirely under spikes/phase-14 and writes only to tmp/.",
  );
  lines.push("");
  lines.push(`## 19. SHEET_GENERATION_MODEL unset confirmation`);
  lines.push("");
  lines.push(
    inputs.sheetGenerationModel === null
      ? "Confirmed: SHEET_GENERATION_MODEL is unset (verified at run start)."
      : `WARNING: SHEET_GENERATION_MODEL was set to "${inputs.sheetGenerationModel}".`,
  );
  lines.push("");
  lines.push(`## 20. git status --short`);
  lines.push("");
  lines.push("```");
  lines.push(inputs.gitStatusShort);
  lines.push("```");
  lines.push("");
  lines.push(CLOSING_PHRASES[inputs.overall]);
  return lines.join("\n");
}

function failedChecksSummary(evaluation: FixtureEvaluation): string {
  const failed: string[] = [];
  if (!evaluation.checks.countExact) failed.push("count");
  if (!evaluation.checks.kindsExact) failed.push("kinds");
  if (!evaluation.checks.paramsExact) failed.push("params");
  if (!evaluation.checks.orderExact) failed.push("order");
  if (!evaluation.checks.gatingRespected) failed.push("gating");
  if (!evaluation.checks.noFabricationFlags) failed.push("forbidden-op");
  if (!evaluation.checks.detailPreserved) failed.push("detail");
  if (!evaluation.checks.attemptsWithinBudget) failed.push("budget");
  return failed.length === 0 ? "all" : `fail: ${failed.join(", ")}`;
}

function evaluationsById(
  evaluations: readonly FixtureEvaluation[],
): Map<string, FixtureEvaluation> {
  return new Map(
    evaluations.map((evaluation) => [evaluation.fixtureId, evaluation]),
  );
}

function criticalNarrative(
  inputs: ExtractionReportInputs,
  leftId: string,
  rightId: string | null,
  intro: string,
): string[] {
  const byId = evaluationsById(inputs.evaluations);
  const left = byId.get(leftId);
  const right = rightId === null ? null : (byId.get(rightId) ?? null);
  const sentences: string[] = [];
  sentences.push(intro);
  if (left !== undefined) {
    sentences.push(
      `- ${leftId}: ${verdict(left)} (class ${left.classification}; actual ops: ${opTokens(left)})`,
    );
  }
  if (right !== null && right !== undefined) {
    sentences.push(
      `- ${rightId}: ${verdict(right)} (class ${right.classification}; actual ops: ${opTokens(right)})`,
    );
  }
  if (left !== undefined && left.gatingActed) {
    sentences.push(
      `- ${leftId}: deterministic portrait gating acted (NPC-portrait diagnostic appended).`,
    );
  }
  if (right !== null && right !== undefined && right.gatingActed) {
    sentences.push(
      `- ${rightId}: deterministic portrait gating acted (NPC-portrait diagnostic appended).`,
    );
  }
  return sentences;
}

function singleNarrative(
  inputs: ExtractionReportInputs,
  fixtureId: string,
  intro: string,
): string[] {
  const evaluation = evaluationsById(inputs.evaluations).get(fixtureId);
  if (evaluation === undefined) {
    return [intro, `- ${fixtureId}: not run`];
  }
  return [
    intro,
    `- ${fixtureId}: ${verdict(evaluation)} (class ${evaluation.classification}; actual ops: ${opTokens(evaluation)})`,
  ];
}

function verdict(evaluation: FixtureEvaluation): string {
  return evaluation.passed ? "PASS" : "FAIL";
}

function opTokens(evaluation: FixtureEvaluation): string {
  return evaluation.finalSignatures.map(signatureOpToken).join(", ") || "[]";
}

function replayReliabilitySection(inputs: ExtractionReportInputs): string[] {
  const { aggregate } = inputs;
  const passedOnFirstAttempt = inputs.evaluations.filter(
    (evaluation) => evaluation.passed && !evaluation.checks.replayUsed,
  ).length;
  return [
    `## 13. Schema/replay reliability`,
    "",
    `Fixtures passed without a replay: ${passedOnFirstAttempt}/${inputs.evaluations.length}.`,
    `Provider calls: ${aggregate.totalCalls}; replays used: ${aggregate.replayUsedCount}; ` +
      `replays that recovered to a valid result: ${aggregate.recoveredOnReplayCount}. ` +
      `Persistent invalid proposals classify as B (JSON parse) / C (schema) / F (replay failed to correct).`,
  ];
}

function latencySection(
  aggregate: RunAggregate,
  evaluations: readonly FixtureEvaluation[],
): string[] {
  const perFixture = evaluations
    .map(
      (evaluation) =>
        `  - ${evaluation.fixtureId}: calls=${evaluation.calls.length} total=${evaluation.totalElapsedMs}ms` +
        (evaluation.calls.length > 0
          ? ` first=${evaluation.calls[0]!.elapsedMs}ms`
          : ""),
    )
    .join("\n");
  return [
    `## 14. Latency/token usage`,
    "",
    `Total elapsed: ${Math.round(aggregate.totalLatencyMs)}ms; total provider calls: ${aggregate.totalCalls}; ` +
      `total reported output tokens: ${aggregate.totalOutputTokens}.`,
    "",
    "Per fixture:",
    "",
    perFixture,
  ];
}

function failureTaxonomySection(aggregate: RunAggregate): string[] {
  const counts = Object.entries(aggregate.failureClassCounts)
    .filter(([, count]) => count > 0)
    .map(
      ([code, count]) =>
        `- ${code} (${FAILURE_CLASS_LABELS[code as keyof typeof FAILURE_CLASS_LABELS]}): ${count}`,
    );
  const body = counts.length === 0 ? ["- (no failures)"] : counts;
  return [`## 15. Failure classifications A-F`, "", ...body];
}

function promptRecommendation(
  overall: OverallClass,
  aggregate: RunAggregate,
): string {
  if (overall === "A") {
    return "No prompt or schema change is recommended by this run. The extraction contract produced the exact expected proposals on the critical fixture set.";
  }
  if (overall === "B") {
    return "Refinement is limited to non-critical fixtures. Keep the current system prompt and schema; consider only the specific failing op guidance before any follow-up run.";
  }
  if (overall === "C") {
    return "At least one critical fixture failed. Before editing the system prompt or schema, replay this exact matrix once to confirm stability and inspect the recorded raws for the failing critical fixtures.";
  }
  return "The run never reached models. No prompt or schema conclusion can be drawn; re-run after the provider/quota condition is resolved.";
}
