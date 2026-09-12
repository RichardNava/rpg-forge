import type { InstructionExtractionOutcome } from "@repo/character-sheet-generation";
import {
  classifyAttempt,
  type AttemptIndicator,
  type FailureClass,
} from "./classify.js";
import type { ExtractionValidationFixture } from "./fixtures.js";
import {
  instructionToSignature,
  signatureMatches,
  signatureOpToken,
  type ExtractionSignature,
} from "./signatures.js";

export interface ExtractionCallRecord {
  readonly attemptNumber: number;
  readonly isCorrectionReplay: boolean;
  readonly system: string;
  readonly user: string;
  readonly raw: string;
  readonly error: { readonly name: string; readonly message: string } | null;
  readonly finishReason: string | null;
  readonly usage: unknown;
  readonly elapsedMs: number;
}

export interface ExtractionRunResult {
  readonly fixtureId: string;
  readonly outcome: InstructionExtractionOutcome;
  readonly calls: readonly ExtractionCallRecord[];
  readonly totalElapsedMs: number;
}

export interface FixtureChecks {
  readonly countExact: boolean;
  readonly kindsExact: boolean;
  readonly paramsExact: boolean;
  readonly orderExact: boolean;
  readonly gatingRespected: boolean;
  readonly noFabricationFlags: boolean;
  readonly detailPreserved: boolean;
  readonly attemptsWithinBudget: boolean;
  readonly replayUsed: boolean;
  readonly recoveredOnReplay: boolean;
  readonly diagnosticsAppropriate: boolean;
}

export interface FixtureEvaluation {
  readonly fixtureId: string;
  readonly mode: "pc" | "npc";
  readonly critical: boolean;
  readonly passed: boolean;
  readonly outcomeKind: "ok" | "extraction_unavailable" | "invalid_proposal";
  readonly checks: FixtureChecks;
  readonly classification: FailureClass | "PASS";
  readonly finalSignatures: readonly ExtractionSignature[];
  readonly gatingActed: boolean;
  readonly diagnosticCodes: readonly string[];
  readonly attempts: readonly AttemptIndicator[];
  readonly calls: readonly ExtractionCallRecord[];
  readonly totalElapsedMs: number;
  readonly notes: readonly string[];
}

function toSignatureList(
  outcome: InstructionExtractionOutcome,
): ExtractionSignature[] {
  return outcome.kind === "ok"
    ? outcome.result.proposedInstructions.map(instructionToSignature)
    : [];
}

function signatureMultisetEquals(
  actual: readonly ExtractionSignature[],
  expected: readonly ExtractionSignature[],
  level: "kinds" | "params",
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const remaining = [...expected];
  for (const item of actual) {
    const index = remaining.findIndex((candidate) =>
      level === "kinds"
        ? signatureOpToken(item) === signatureOpToken(candidate)
        : signatureMatches(item, candidate),
    );
    if (index === -1) {
      return false;
    }
    remaining.splice(index, 1);
  }
  return true;
}

function signatureSequenceEquals(
  actual: readonly ExtractionSignature[],
  expected: readonly ExtractionSignature[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((item, index) => {
    const candidate = expected[index];
    return candidate !== undefined && signatureMatches(item, candidate);
  });
}

function normalizeDetailText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function portraitsPreserveDetails(
  outcome: InstructionExtractionOutcome,
  requiredTokens: readonly string[],
): boolean {
  if (outcome.kind !== "ok") {
    return false;
  }
  const portraits = outcome.result.proposedInstructions.filter(
    (instruction) => instruction.op === "request_npc_portrait",
  );
  if (portraits.length === 0) {
    return requiredTokens.length === 0;
  }
  return portraits.every((portrait) => {
    const text = normalizeDetailText(
      `${portrait.intent.description ?? ""} ${portrait.intent.prompt ?? ""}`,
    );
    return requiredTokens.every((token) =>
      text.includes(normalizeDetailText(token)),
    );
  });
}

function classifyFixture(
  outcomeKind: "ok" | "extraction_unavailable" | "invalid_proposal",
  checks: FixtureChecks,
  run: ExtractionRunResult,
): FailureClass | "PASS" {
  if (!checks.attemptsWithinBudget) {
    return "A";
  }
  if (outcomeKind === "extraction_unavailable") {
    return "A";
  }
  if (outcomeKind === "invalid_proposal") {
    if (checks.replayUsed) {
      return "F";
    }
    const last = run.calls[run.calls.length - 1];
    if (last === undefined) {
      return "C";
    }
    return classifyAttempt({ raw: last.raw, error: last.error }) === "json_fail"
      ? "B"
      : "C";
  }
  const semanticFailure =
    !checks.countExact ||
    !checks.kindsExact ||
    !checks.paramsExact ||
    !checks.orderExact ||
    !checks.detailPreserved ||
    !checks.noFabricationFlags;
  if (!checks.gatingRespected) {
    return "E";
  }
  if (semanticFailure) {
    return "D";
  }
  return "PASS";
}

/**
 * Evaluates one fixture run against its exact expectations. PASS requires the
 * final gated outcome to be a valid ok result whose proposed instructions match
 * the expected count, kinds, parameters, order (where required), gating rules,
 * detail preservation and op prohibitions, within the two-attempt budget.
 */
export function evaluateExtractionFixture(
  fixture: ExtractionValidationFixture,
  run: ExtractionRunResult,
): FixtureEvaluation {
  const expected = fixture.expected;
  const actual = toSignatureList(run.outcome);
  const calls = run.calls;
  const attempts = calls.map((call) =>
    classifyAttempt({ raw: call.raw, error: call.error }),
  );
  const replayUsed = calls.length >= 2;
  const recoveredOnReplay = replayUsed && run.outcome.kind === "ok";
  const outcomeKind = run.outcome.kind;
  const forbidden = fixture.forbidOps ?? [];

  const checks: FixtureChecks = {
    countExact: actual.length === expected.length,
    kindsExact: signatureMultisetEquals(actual, expected, "kinds"),
    paramsExact: signatureMultisetEquals(actual, expected, "params"),
    orderExact: fixture.requireOrder
      ? signatureSequenceEquals(actual, expected)
      : true,
    gatingRespected: !(
      fixture.mode === "pc" &&
      actual.some((signature) => signature.kind === "portrait")
    ),
    noFabricationFlags: forbidden.every(
      (token) =>
        !actual.some((signature) => signatureOpToken(signature) === token),
    ),
    detailPreserved: portraitsPreserveDetails(
      run.outcome,
      fixture.requireDetailTokens ?? [],
    ),
    attemptsWithinBudget: calls.length <= 2,
    replayUsed,
    recoveredOnReplay,
    diagnosticsAppropriate:
      run.outcome.kind !== "ok" ||
      run.outcome.result.diagnostics.every(
        (diagnostic) =>
          diagnostic.code === "unsupported-instruction" ||
          diagnostic.code === "target-not-actionable",
      ),
  };

  const notes: string[] = [];
  if (!checks.countExact) {
    notes.push(
      `instruction count mismatch: expected ${expected.length}, got ${actual.length}`,
    );
  }
  if (checks.countExact && !checks.kindsExact) {
    notes.push("instruction kind multiset mismatch");
  }
  if (checks.kindsExact && !checks.paramsExact) {
    notes.push("instruction parameter multiset mismatch");
  }
  if (fixture.requireOrder && !checks.orderExact) {
    notes.push("instruction order differs from the stated request order");
  }
  if (!checks.gatingRespected) {
    notes.push("NPC portrait leaked into a PC-sheet result");
  }
  if (!checks.noFabricationFlags) {
    notes.push(
      `forbidden op appeared in the final result: ${forbidden.join(", ")}`,
    );
  }
  if (!checks.detailPreserved) {
    notes.push("portrait description missed required explicit detail tokens");
  }
  if (!checks.attemptsWithinBudget) {
    notes.push("provider-call budget (first + one replay) exceeded");
  }

  const passed =
    outcomeKind === "ok" &&
    checks.countExact &&
    checks.kindsExact &&
    checks.paramsExact &&
    checks.orderExact &&
    checks.gatingRespected &&
    checks.noFabricationFlags &&
    checks.detailPreserved &&
    checks.attemptsWithinBudget;

  return {
    fixtureId: fixture.id,
    mode: fixture.mode,
    critical: fixture.critical,
    passed,
    outcomeKind,
    checks,
    classification: classifyFixture(outcomeKind, checks, run),
    finalSignatures: actual,
    gatingActed:
      run.outcome.kind === "ok" &&
      run.outcome.result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unsupported-instruction" &&
          (diagnostic.detail ?? "").toLowerCase().includes("portrait"),
      ),
    diagnosticCodes:
      run.outcome.kind === "ok"
        ? run.outcome.result.diagnostics.map((diagnostic) => diagnostic.code)
        : [],
    attempts,
    calls,
    totalElapsedMs: run.totalElapsedMs,
    notes,
  };
}
