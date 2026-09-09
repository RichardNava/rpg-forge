import {
  getRulesAnalysisOutputJsonSchema,
  type RuleAnalysisPort,
} from "@repo/rules-analysis-run";
import { AiProviderUnavailableError } from "./ai-errors.js";

/**
 * ADR-053 analysis model. The request is sent as role-separated messages:
 * trusted `system` instructions and an untrusted `user` data message; no tools
 * are ever declared. Response is constrained with json_schema; the domain still
 * parses and re-validates the raw text, so a provider that ignores the schema
 * cannot bypass the strict output gate.
 */
export const RULES_ANALYSIS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Upper bound for the generated JSON. A validated analysis can legitimately
 * contain many rules, but it must stay far below the model's context size.
 */
export const MAX_RULES_ANALYSIS_OUTPUT_TOKENS = 8192;

export function createCloudflareAiRuleAnalysis(ai: Ai): RuleAnalysisPort {
  return {
    async generate(input) {
      let result: unknown;
      try {
        result = await ai.run(RULES_ANALYSIS_MODEL, {
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          max_tokens: MAX_RULES_ANALYSIS_OUTPUT_TOKENS,
          response_format: {
            type: "json_schema",
            json_schema: getRulesAnalysisOutputJsonSchema(),
          },
        });
      } catch {
        throw new AiProviderUnavailableError();
      }

      const raw = extractResponseText(result);
      if (raw === null) {
        throw new AiProviderUnavailableError();
      }
      return raw;
    },
  };
}

function extractResponseText(result: unknown): string | null {
  if (typeof result === "string") {
    return result.length > 0 ? result : null;
  }
  if (typeof result === "object" && result !== null) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string" && response.length > 0) {
      return response;
    }
  }
  return null;
}
