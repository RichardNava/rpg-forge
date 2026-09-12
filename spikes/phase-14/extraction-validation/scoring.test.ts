import { describe, expect, it } from "vitest";
import {
  InstructionExtractionResultSchema,
  type InstructionExtractionOutcome,
  type ProposedGenerationInstruction,
} from "@repo/character-sheet-generation";
import {
  EXTRACTION_VALIDATION_FIXTURES,
  getExtractionFixtureById,
} from "./fixtures.js";
import {
  evaluateExtractionFixture,
  type ExtractionCallRecord,
  type ExtractionRunResult,
} from "./scoring.js";
import { signatureToInstruction } from "./signatures.js";

type TestDiagnostic = {
  code: "unsupported-instruction" | "target-not-actionable";
  detail?: string;
};

function okOutcome(
  instructions: readonly ProposedGenerationInstruction[],
  diagnostics: readonly TestDiagnostic[] = [],
): InstructionExtractionOutcome {
  const result = InstructionExtractionResultSchema.parse({
    proposedInstructions: [...instructions],
    diagnostics: [...diagnostics],
  });
  return { kind: "ok", result };
}

function invalidOutcome(message: string): InstructionExtractionOutcome {
  return { kind: "invalid_proposal", message };
}

function call(
  overrides: Partial<ExtractionCallRecord> = {},
): ExtractionCallRecord {
  return {
    attemptNumber: 1,
    isCorrectionReplay: false,
    system: "system",
    user: "user",
    raw: "",
    error: null,
    finishReason: "stop",
    usage: null,
    elapsedMs: 100,
    ...overrides,
  };
}

function run(
  fixtureId: string,
  outcome: InstructionExtractionOutcome,
  calls: readonly ExtractionCallRecord[],
): ExtractionRunResult {
  return { fixtureId, outcome, calls, totalElapsedMs: 200 };
}

function singleOkCall(
  instructions: readonly ProposedGenerationInstruction[],
): ExtractionCallRecord[] {
  return [call({ raw: JSON.stringify({ instructions, diagnostics: [] }) })];
}

function forFixture(fixtureId: string) {
  const fixture = getExtractionFixtureById(fixtureId);
  if (fixture === undefined) {
    throw new Error(`fixture ${fixtureId} not found`);
  }
  return fixture;
}

function evalFixture(
  fixtureId: string,
  outcome: InstructionExtractionOutcome,
  calls: readonly ExtractionCallRecord[] = singleOkCall([]),
) {
  return evaluateExtractionFixture(
    forFixture(fixtureId),
    run(fixtureId, outcome, calls),
  );
}

/** Renders the expected signatures of a fixture as proposed instructions. */
function expectedInstructions(
  fixtureId: string,
): ProposedGenerationInstruction[] {
  const fixture = forFixture(fixtureId);
  return fixture.expected.map((signature) =>
    signatureToInstruction(
      signature,
      fixture.requireDetailTokens?.join(" ") ?? "a requested NPC portrait",
    ),
  );
}

describe("extraction-validation scoring", () => {
  it("rejects an F1 ADD that becomes a REPLACE (semantic)", () => {
    const evaluation = evalFixture(
      "F1",
      okOutcome([
        {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: "Constitution",
            replacementLabel: "Vigor",
          },
        },
      ]),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.classification).toBe("D");
    expect(evaluation.checks.kindsExact).toBe(false);
  });

  it("accepts F1 exactly as ADD Vigor", () => {
    const evaluation = evalFixture("F1", okOutcome(expectedInstructions("F1")));
    expect(evaluation.passed).toBe(true);
    expect(evaluation.classification).toBe("PASS");
  });

  it("rejects an F2 REPLACE that becomes an ADD or RENAME", () => {
    const addResult = evalFixture(
      "F2",
      okOutcome([
        {
          op: "field",
          override: { op: "add", label: "Vigor", category: "mechanical" },
        },
      ]),
    );
    expect(addResult.passed).toBe(false);
    expect(addResult.classification).toBe("D");

    const renameResult = evalFixture(
      "F2",
      okOutcome([
        {
          op: "field",
          override: {
            op: "rename",
            sourceLabel: "Constitution",
            newLabel: "Vigor",
          },
        },
      ]),
    );
    expect(renameResult.passed).toBe(false);
    expect(renameResult.classification).toBe("D");
  });

  it("accepts F2 exactly as REPLACE Constitution->Vigor", () => {
    const evaluation = evalFixture("F2", okOutcome(expectedInstructions("F2")));
    expect(evaluation.passed).toBe(true);
  });

  it("rejects F4 with a wrong value (params mismatch)", () => {
    const evaluation = evalFixture(
      "F4",
      okOutcome([
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Strength", value: 17 },
        },
      ]),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.classification).toBe("D");
    expect(evaluation.checks.paramsExact).toBe(false);
  });

  it("accepts F4 exactly as SET_VALUE Strength=16", () => {
    expect(
      evalFixture("F4", okOutcome(expectedInstructions("F4"))).passed,
    ).toBe(true);
  });

  it("rejects F5 with the wrong bound", () => {
    const evaluation = evalFixture(
      "F5",
      okOutcome([
        {
          op: "field",
          override: { op: "constrain", targetLabel: "Strength", max: 20 },
        },
      ]),
    );
    expect(evaluation.passed).toBe(false);
  });

  it("rejects F6 when a numeric op is fabricated", () => {
    const evaluation = evalFixture(
      "F6",
      okOutcome([
        {
          op: "field",
          override: { op: "set_value", targetLabel: "Strength", value: 12 },
        },
      ]),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.noFabricationFlags).toBe(false);
  });

  it("accepts F6 with an empty proposal list", () => {
    expect(evalFixture("F6", okOutcome([])).passed).toBe(true);
  });

  it("accepts F7 only with the exact trimmed name", () => {
    expect(
      evalFixture("F7", okOutcome(expectedInstructions("F7"))).passed,
    ).toBe(true);
    const wrong = evalFixture(
      "F7",
      okOutcome([{ op: "set_character_name", value: "Grok" }]),
    );
    expect(wrong.passed).toBe(false);
  });

  it("fails F8 when required portrait details are missing", () => {
    const missing = evalFixture(
      "F8",
      okOutcome([
        {
          op: "request_npc_portrait",
          intent: {
            requestedVia: "contextInstructions",
            description: "a big troll",
          },
        },
      ]),
    );
    expect(missing.passed).toBe(false);
    expect(missing.checks.detailPreserved).toBe(false);
  });

  it("accepts F8 when every explicit detail token is preserved", () => {
    const evaluation = evalFixture(
      "F8",
      okOutcome([
        {
          op: "request_npc_portrait",
          intent: {
            requestedVia: "contextInstructions",
            description:
              "A large bluish troll with a long goatee, pointed nose and an eye patch.",
          },
        },
      ]),
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.detailPreserved).toBe(true);
  });

  it("accepts F9 only with no portrait (deterministic gating)", () => {
    expect(evalFixture("F9", okOutcome([])).passed).toBe(true);

    const leaked = evalFixture(
      "F9",
      okOutcome([
        {
          op: "request_npc_portrait",
          intent: {
            requestedVia: "contextInstructions",
            description: "a troll",
          },
        },
      ]),
    );
    expect(leaked.passed).toBe(false);
    expect(leaked.classification).toBe("E");
    expect(leaked.checks.gatingRespected).toBe(false);
  });

  it("accepts an F9 pipeline-gated outcome and marks gating as acted", () => {
    const evaluation = evalFixture(
      "F9",
      okOutcome(
        [],
        [
          {
            code: "unsupported-instruction",
            detail: "NPC portrait requests require an NPC sheet mode.",
          },
        ],
      ),
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.gatingActed).toBe(true);
  });

  it("rejects F10 when a REPLACE is fabricated", () => {
    const evaluation = evalFixture(
      "F10",
      okOutcome([
        {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: "Constitution",
            replacementLabel: "Vigor",
          },
        },
      ]),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.noFabricationFlags).toBe(false);
  });

  it("accepts F10 with an empty proposal list (target-not-actionable)", () => {
    expect(evalFixture("F10", okOutcome([])).passed).toBe(true);
  });

  it("rejects F11 when the instruction order is wrong", () => {
    const [replace, setValue, name, portrait] = forFixture("F11").expected.map(
      (signature) => signatureToInstruction(signature),
    );
    const reordered = evalFixture(
      "F11",
      okOutcome([setValue!, replace!, portrait!, name!]),
    );
    expect(reordered.passed).toBe(false);
    expect(reordered.checks.orderExact).toBe(false);
    expect(reordered.classification).toBe("D");
  });

  it("accepts F11 with the exact stated order", () => {
    expect(
      evalFixture("F11", okOutcome(expectedInstructions("F11"))).passed,
    ).toBe(true);
  });

  it("accepts F12 preserving the Spanish source label", () => {
    const evaluation = evalFixture(
      "F12",
      okOutcome(expectedInstructions("F12")),
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.orderExact).toBe(true);
  });

  it("accepts F13 only as a structured ADD Luck (injection contained)", () => {
    expect(
      evalFixture("F13", okOutcome(expectedInstructions("F13"))).passed,
    ).toBe(true);
    const escaped = evalFixture(
      "F13",
      okOutcome([
        {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: "Schema",
            replacementLabel: "Luck",
          },
        },
      ]),
    );
    expect(escaped.passed).toBe(false);
  });

  it("classifies a provider throw as A", () => {
    const evaluation = evalFixture("F1", { kind: "extraction_unavailable" }, [
      call({ error: { name: "Error", message: "provider down" } }),
    ]);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.classification).toBe("A");
  });

  it("classifies a persistent JSON parse failure as B", () => {
    const evaluation = evalFixture("F1", invalidOutcome("not JSON"), [
      call({ attemptNumber: 1, raw: "not json" }),
    ]);
    expect(evaluation.classification).toBe("B");
  });

  it("classifies a persistent schema failure as C", () => {
    const evaluation = evalFixture(
      "F1",
      invalidOutcome("did not match schema"),
      [call({ raw: '{"instructions": 42}' })],
    );
    expect(evaluation.classification).toBe("C");
  });

  it("classifies a replayed-but-still-invalid outcome as F", () => {
    const evaluation = evalFixture(
      "F1",
      invalidOutcome("did not match schema"),
      [
        call({ attemptNumber: 1, raw: '{"instructions": 42}' }),
        call({
          attemptNumber: 2,
          isCorrectionReplay: true,
          raw: '{"still": "wrong"}',
        }),
      ],
    );
    expect(evaluation.checks.replayUsed).toBe(true);
    expect(evaluation.classification).toBe("F");
  });

  it("marks a replay that recovered as PASS with recoveredOnReplay", () => {
    const evaluation = evalFixture(
      "F1",
      okOutcome(expectedInstructions("F1")),
      [
        call({ attemptNumber: 1, raw: '{"instructions": 42}' }),
        call({
          attemptNumber: 2,
          isCorrectionReplay: true,
          raw: JSON.stringify({
            instructions: expectedInstructions("F1"),
            diagnostics: [],
          }),
        }),
      ],
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.replayUsed).toBe(true);
    expect(evaluation.checks.recoveredOnReplay).toBe(true);
  });

  it("rejects an outcome exceeding the provider-call budget", () => {
    const evaluation = evalFixture(
      "F1",
      okOutcome(expectedInstructions("F1")),
      [
        call({ attemptNumber: 1, raw: "{}" }),
        call({ attemptNumber: 2, isCorrectionReplay: true, raw: "{}" }),
        call({ attemptNumber: 3, isCorrectionReplay: true, raw: "{}" }),
      ],
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.classification).toBe("A");
  });

  it("evaluates every fixture with its own expected instructions as PASS", () => {
    const fixturesRequiringEmpty = new Set(["F6", "F9", "F10"]);
    let passed = 0;
    for (const fixture of EXTRACTION_VALIDATION_FIXTURES) {
      const instructions = fixturesRequiringEmpty.has(fixture.id)
        ? []
        : expectedInstructions(fixture.id);
      const evaluation = evalFixture(fixture.id, okOutcome(instructions));
      expect(
        evaluation.passed,
        `fixture ${fixture.id} should pass its own expectation`,
      ).toBe(true);
      if (evaluation.passed) {
        passed += 1;
      }
    }
    expect(passed).toBe(EXTRACTION_VALIDATION_FIXTURES.length);
  });
});
