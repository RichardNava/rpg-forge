import { InstructionExtractionOutputSchema } from "@repo/character-sheet-generation";

/**
 * Per-attempt outcome classification. The classification deliberately mirrors
 * the real 2C2A parser: JSON.parse first, then the canonical output schema.
 * `provider_error` means the provider never produced text.
 */
export type AttemptIndicator =
  "provider_error" | "json_fail" | "schema_fail" | "ok";

export function classifyAttempt(result: {
  readonly raw: string;
  readonly error: { readonly name: string; readonly message: string } | null;
}): AttemptIndicator {
  if (result.error !== null) {
    return "provider_error";
  }
  let value: unknown;
  try {
    value = JSON.parse(result.raw) as unknown;
  } catch {
    return "json_fail";
  }
  return InstructionExtractionOutputSchema.safeParse(value).success
    ? "ok"
    : "schema_fail";
}

/**
 * 2C2B failure taxonomy:
 *  A provider/transport
 *  B JSON parse
 *  C structured-output schema
 *  D semantic extraction
 *  E mode gating
 *  F correction replay
 */
export type FailureClass = "A" | "B" | "C" | "D" | "E" | "F";

export const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  A: "provider/transport",
  B: "JSON parse",
  C: "structured-output schema",
  D: "semantic extraction",
  E: "mode gating",
  F: "correction replay",
};
