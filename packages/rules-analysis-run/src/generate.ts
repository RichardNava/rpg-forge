import type { RulebookChunk } from "@repo/rulebook-ingestion";
import { z } from "zod";
import {
  RulesAnalysisOutputSchema,
  type RulesAnalysisOutput,
} from "./output.js";
import type { AnalysisPromptInput } from "./prompt.js";
import type { RuleAnalysisPort } from "./ports.js";

export const embeddingShapeError = new Error("Embedding shape mismatch.");

export interface GenerateValidatedOutputOptions {
  promptInput: AnalysisPromptInput;
  chunksById: ReadonlyMap<string, RulebookChunk>;
  retrievedChunkIds: ReadonlySet<string>;
  analysis: RuleAnalysisPort;
}

export type ParsedOutput =
  { ok: true; output: RulesAnalysisOutput } | { ok: false; error: string };

export function parseAnalysisOutput(raw: string): ParsedOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "The model response was not valid JSON." };
  }
  const result = RulesAnalysisOutputSchema.safeParse(value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, output: result.data };
}

function formatZodErrors(error: z.ZodError): string {
  const lines = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length === 0 ? "." : issue.path.join(".");
    return `- ${path}: ${issue.message}`;
  });
  return `The model response did not match the required schema:\n${lines.join("\n")}`;
}
