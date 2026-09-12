import {
  extractContextInstructions,
  type InstructionExtractionPort,
} from "@repo/character-sheet-generation";
import { RecordingInstructionExtractionPort } from "./remote-port.js";
import type { ExtractionRunResult } from "./scoring.js";
import { EXTRACTION_RETRY_BUDGET } from "./config.js";

/**
 * Runs one fixture through the REAL extraction pipeline: builder-produced
 * prompts, canonical JSON schema, runtime Zod parser, bounded correction replay
 * and deterministic mode gating. Nothing here reimplements the contract; only
 * the provider port and the recording wrapper are spike-owned.
 *
 * The pipeline itself enforces the provider-call budget
 * (`SHEET_GENERATION_RETRIES` in the domain = 2 attempts = first + one replay),
 * which is asserted again by the scorer against `EXTRACTION_RETRY_BUDGET`.
 */
export async function runExtractionFixture(input: {
  readonly fixture: {
    readonly id: string;
    readonly mode: "pc" | "npc";
    readonly contextInstructions: string;
    readonly fields: readonly {
      readonly label: string;
      readonly category: "mechanical" | "identity";
      readonly canonicalKey: string;
    }[];
  };
  readonly port: InstructionExtractionPort;
}): Promise<ExtractionRunResult> {
  const recording = new RecordingInstructionExtractionPort(input.port);
  const startedAt = performance.now();
  const outcome = await extractContextInstructions(
    {
      contextInstructions: input.fixture.contextInstructions,
      mode: input.fixture.mode,
      fields: [...input.fixture.fields],
    },
    { extractionPort: recording },
  );
  const totalElapsedMs =
    Math.round((performance.now() - startedAt) * 100) / 100;

  if (recording.calls.length > EXTRACTION_RETRY_BUDGET) {
    throw new Error(
      `Fixture ${input.fixture.id} exceeded the provider-call budget of ${EXTRACTION_RETRY_BUDGET} attempts.`,
    );
  }

  return {
    fixtureId: input.fixture.id,
    outcome,
    calls: recording.calls,
    totalElapsedMs,
  };
}
