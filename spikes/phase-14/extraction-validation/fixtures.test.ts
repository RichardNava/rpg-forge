import { describe, expect, it } from "vitest";
import {
  InstructionExtractionOutputSchema,
  InstructionExtractionInputSchema,
} from "@repo/character-sheet-generation";
import { EXTRACTION_VALIDATION_FIXTURES } from "./fixtures.js";
import { signatureToInstruction } from "./signatures.js";

/**
 * Local preflight: every fixture expectation must be constructible under the
 * canonical instruction/output schemas. A malformed expectation (wrong label,
 * inverted bound, impossible order) fails here before any remote inference.
 */
describe("extraction-validation fixtures", () => {
  it("all fixture expectations round-trip through the canonical output schema", () => {
    for (const fixture of EXTRACTION_VALIDATION_FIXTURES) {
      const output = {
        instructions: fixture.expected.map((signature) =>
          signatureToInstruction(signature),
        ),
        diagnostics: [],
      };
      const parsed = InstructionExtractionOutputSchema.safeParse(output);
      expect(
        parsed.success,
        `fixture ${fixture.id} expectation is not constructible: ${
          parsed.success ? "" : parsed.error.message
        }`,
      ).toBe(true);
    }
  });

  it("every fixture input is valid under the extraction input schema", () => {
    for (const fixture of EXTRACTION_VALIDATION_FIXTURES) {
      const parsed = InstructionExtractionInputSchema.safeParse({
        contextInstructions: fixture.contextInstructions,
        mode: fixture.mode,
        fields: fixture.fields,
      });
      expect(
        parsed.success,
        `fixture ${fixture.id} input is invalid: ${
          parsed.success ? "" : parsed.error.message
        }`,
      ).toBe(true);
    }
  });

  it("every fixture carries non-blank contextInstructions", () => {
    for (const fixture of EXTRACTION_VALIDATION_FIXTURES) {
      expect(fixture.contextInstructions.trim().length).toBeGreaterThan(0);
    }
  });

  it("requires order only where mixed instruction order matters", () => {
    const orderFixtures = EXTRACTION_VALIDATION_FIXTURES.filter(
      (fixture) => fixture.requireOrder,
    );
    expect(orderFixtures.map((fixture) => fixture.id).sort()).toEqual([
      "F11",
      "F12",
    ]);
  });
});
