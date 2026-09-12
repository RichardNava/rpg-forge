import { z } from "zod";
import type {
  InstructionExtractionDeps,
  InstructionExtractionPort,
} from "./ports.js";
import {
  CharacterSheetAuthoringModeSchema,
  MAX_AUTHORING_CONTEXT_CHARS,
  type CharacterSheetAuthoringMode,
} from "./authoring.js";
import { MAX_TOTAL_FIELDS, SHEET_GENERATION_RETRIES } from "./model.js";
import {
  ExtractionFieldContextSchema,
  InstructionExtractionOutputSchema,
  type InstructionExtractionDiagnostic,
  type InstructionExtractionOutput,
  type InstructionExtractionResult,
} from "./extraction-schemas.js";
import {
  appendValidationFeedback,
  buildInstructionExtractionSystemPrompt,
  buildInstructionExtractionUserPrompt,
} from "./prompt.js";

export type {
  InstructionExtractionDeps,
  InstructionExtractionPort,
} from "./ports.js";

export const InstructionExtractionInputSchema = z.strictObject({
  contextInstructions: z.string().max(MAX_AUTHORING_CONTEXT_CHARS).optional(),
  mode: CharacterSheetAuthoringModeSchema,
  fields: z
    .array(ExtractionFieldContextSchema)
    .max(MAX_TOTAL_FIELDS)
    .optional(),
});
export type InstructionExtractionInput = z.infer<
  typeof InstructionExtractionInputSchema
>;

export type InstructionExtractionOutcome =
  | { kind: "ok"; result: InstructionExtractionResult }
  | { kind: "extraction_unavailable" }
  | { kind: "invalid_proposal"; message: string };

type ParsedExtraction =
  | { ok: true; output: InstructionExtractionOutput }
  | { ok: false; error: string };

function parseInstructionExtractionOutput(raw: string): ParsedExtraction {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = InstructionExtractionOutputSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, output: result.data };
}

/**
 * Deterministic app-side gating. Model diagnostics are advisory; here the app
 * enforces its own rules (for example that NPC portrait requests are dropped
 * for PC sheets, mirroring the 2C1 veto) and appends a diagnostic explaining
 * what was intentionally filtered.
 */
export function applyModeGating(
  output: InstructionExtractionOutput,
  mode: CharacterSheetAuthoringMode,
): InstructionExtractionResult {
  const diagnostics: InstructionExtractionDiagnostic[] = [
    ...output.diagnostics,
  ];
  const proposedInstructions = output.instructions.filter((instruction) => {
    if (instruction.op === "request_npc_portrait" && mode !== "npc") {
      diagnostics.push({
        code: "unsupported-instruction",
        detail: "NPC portrait requests require an NPC sheet mode.",
      });
      return false;
    }
    return true;
  });
  return { proposedInstructions, diagnostics };
}

/**
 * Converts raw `contextInstructions` into validated, ordered proposal
 * instructions. Blank input short-circuits without a provider call. Invalid
 * syntax gets exactly one bounded correction replay
 * (`SHEET_GENERATION_RETRIES` total attempts); a throwing provider reports
 * `extraction_unavailable`.
 */
export async function extractContextInstructions(
  input: InstructionExtractionInput,
  deps: InstructionExtractionDeps,
): Promise<InstructionExtractionOutcome> {
  const contextInstructions = input.contextInstructions;
  if (
    contextInstructions === undefined ||
    contextInstructions.trim().length === 0
  ) {
    return {
      kind: "ok",
      result: { proposedInstructions: [], diagnostics: [] },
    };
  }

  const system = buildInstructionExtractionSystemPrompt();
  let user = buildInstructionExtractionUserPrompt({
    contextInstructions,
    mode: input.mode,
    fields: input.fields ?? [],
  });

  let lastError = "The model response was not valid JSON.";
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await deps.extractionPort.generate({ system, user });
    } catch {
      return { kind: "extraction_unavailable" };
    }
    const parsed = parseInstructionExtractionOutput(raw);
    if (parsed.ok) {
      return { kind: "ok", result: applyModeGating(parsed.output, input.mode) };
    }
    lastError = parsed.error;
    user = appendValidationFeedback(user, parsed.error);
  }

  return { kind: "invalid_proposal", message: lastError };
}

function parseJson(raw: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { error: "The model response was not valid JSON." };
  }
}

function formatZodErrors(error: z.ZodError): string {
  const lines = error.issues.slice(0, 12).map((issue) => {
    const path = issue.path.length === 0 ? "." : issue.path.join(".");
    return `- ${path}: ${issue.message}`;
  });
  return `The model response did not match the required schema:\n${lines.join("\n")}`;
}
