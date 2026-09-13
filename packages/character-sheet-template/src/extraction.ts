import { z } from "zod";
import {
  CharacterSheetTemplateSourceSchema,
  type CharacterSheetTemplateSource,
} from "./source.js";
import {
  CharacterSheetTemplateSchema,
  getSheetTemplateJsonSchema,
  type CharacterSheetTemplate,
} from "./template.js";

/** One bounded correction replay per stage, matching the sheet-generation gate. */
export const TEMPLATE_EXTRACTION_RETRIES = 2;

function systemPrompt(): string {
  return [
    "You extract the structural template of a physical, blank character sheet.",
    "A template is the roster of fields the sheet visually contains: sections and their labeled fields, each labeled exactly as printed.",
    "You describe the blank sheet structure only. You never invent fields, never infer values from a rulebook, never add content not printed on the sheet, and never emit rendered values.",
    "Mechanical fields (stats, scores, attributes with numeric bounds printed on the sheet) carry their printed bounds when a range is visually present; otherwise leave numericBounds absent.",
    "Identity fields (name, profession, background, notes) are never numeric and never carry bounds.",
    "Section keys are lowercase snake_case. Every field either cites its printed section or omits sectionKey when grouping is not visually certain.",
    "Respond with exactly one JSON object matching the provided schema. No commentary outside the JSON object.",
  ].join("\n");
}

function userPrompt(source: CharacterSheetTemplateSource): string {
  return `Describe the template of the character sheet identified by the following source reference as structured JSON.\n\nSource:\n${JSON.stringify(source)}`;
}

/**
 * Provider-agnostic extraction port. `system` carries trusted instructions
 * only; `user` carries the source reference. Raw-text parsing and validation
 * happen in the domain, so a provider that ignores the schema gate cannot feed
 * a template that bypasses the strict roster cap.
 */
export interface CharacterSheetTemplateExtractionPort {
  extract(input: {
    source: CharacterSheetTemplateSource;
    system: string;
    user: string;
  }): Promise<string>;
}

/**
 * The emitted input-side contract shown to the model. It is the same shape as
 * the canonical template because the extractor output is validated in full; the
 * wrapper exists so the JSON Schema handed to a provider cannot drift from the
 * runtime gate.
 */
export const CharacterSheetTemplateExtractionInputSchema =
  CharacterSheetTemplateSchema;
export type CharacterSheetTemplateExtractionInput = CharacterSheetTemplate;

export type CharacterSheetTemplateExtractionOutcome =
  | { kind: "ok"; template: CharacterSheetTemplate }
  | { kind: "extraction_unavailable" }
  | { kind: "invalid_proposal"; message: string };

type ParsedTemplate =
  { ok: true; template: CharacterSheetTemplate } | { ok: false; error: string };

function parseTemplate(raw: string): ParsedTemplate {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = CharacterSheetTemplateSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, template: result.data };
}

/**
 * Converts a sheet source into a validated template through the extraction
 * port. Invalid syntax gets exactly one bounded correction replay
 * (`TEMPLATE_EXTRACTION_RETRIES` total attempts); a throwing provider reports
 * `extraction_unavailable`.
 */
export async function extractSheetTemplate(
  input: { source: CharacterSheetTemplateSource },
  deps: { extractionPort: CharacterSheetTemplateExtractionPort },
): Promise<CharacterSheetTemplateExtractionOutcome> {
  const source = CharacterSheetTemplateSourceSchema.parse(input.source);
  const system = systemPrompt();
  let user = userPrompt(source);

  let lastError = "The model response was not valid JSON.";
  for (let attempt = 0; attempt < TEMPLATE_EXTRACTION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await deps.extractionPort.extract({ source, system, user });
    } catch {
      return { kind: "extraction_unavailable" };
    }
    const parsed = parseTemplate(raw);
    if (parsed.ok) {
      return { kind: "ok", template: parsed.template };
    }
    lastError = parsed.error;
    user = appendValidationFeedback(user, parsed.error);
  }

  return { kind: "invalid_proposal", message: lastError };
}

export function appendValidationFeedback(
  base: string,
  feedback: string,
): string {
  return `${base}\n\nThe previous response was rejected by the schema gate. Feedback:\n${feedback}\n\nRespond again with exactly one valid JSON object.`;
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

export { getSheetTemplateJsonSchema };
