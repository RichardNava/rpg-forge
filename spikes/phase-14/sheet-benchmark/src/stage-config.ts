import {
  getCalculationCandidatesJsonSchema,
  getFieldCandidatesJsonSchema,
  getSectionPlanJsonSchema,
  type SheetGenerationStage,
} from "@repo/character-sheet-generation";

/**
 * Request-shape constants for the benchmark shim, kept outside the worker entry
 * so the entry exposes only its default ExportedHandler.
 *
 * They mirror the production sheet adapter
 * (apps/rules-worker/src/infrastructure/ai-sheet-generation.ts): role-separated
 * messages, a bounded output cap, and the canonical per-stage json_schema
 * generated from the exact Zod schemas the production domain validates against.
 */
export const MAX_SHEET_BENCH_OUTPUT_TOKENS = 8192;

export const STAGE_JSON_SCHEMA: Record<SheetGenerationStage, unknown> = {
  "section-plan": getSectionPlanJsonSchema(),
  "field-candidates": getFieldCandidatesJsonSchema(),
  calculations: getCalculationCandidatesJsonSchema(),
};

export function isSheetGenerationStage(
  value: unknown,
): value is SheetGenerationStage {
  return typeof value === "string" && Object.hasOwn(STAGE_JSON_SCHEMA, value);
}

/**
 * Persona-specific schema overrides for the section-plan stage. These are
 * benchmark-side request variants that never edit canonical production schemas.
 *
 * The recorded raw schema is spread copy-on-write; $defs/properties are
 * null-guarded so the spread never touches undefined values.
 */
function sectionPlanSchemaParts(): {
  readonly defs: Record<string, unknown>;
  readonly props: Record<string, unknown>;
} {
  const schema = getSectionPlanJsonSchema() as unknown as {
    readonly $defs?: Record<string, unknown>;
    readonly properties?: Record<string, unknown>;
  };
  return { defs: schema.$defs ?? {}, props: schema.properties ?? {} };
}

const PERSONA_SECTION_PLAN_OVERRIDES: Record<string, unknown> = {
  "human-locale": {
    ...getSectionPlanJsonSchema(),
    $defs: { ...sectionPlanSchemaParts().defs },
    properties: { ...sectionPlanSchemaParts().props },
  },
  "strict-schema": {
    ...getSectionPlanJsonSchema(),
    properties: { ...sectionPlanSchemaParts().props },
  },
};

/**
 * Returns the JSON schema to use for the given stage and persona. Falls back
 * to the default production schema when no override exists.
 */
export function getSchemaForStage(
  stage: SheetGenerationStage,
  persona: string | null,
): unknown {
  if (
    stage === "section-plan" &&
    persona !== null &&
    persona in PERSONA_SECTION_PLAN_OVERRIDES
  ) {
    return PERSONA_SECTION_PLAN_OVERRIDES[persona];
  }
  return STAGE_JSON_SCHEMA[stage];
}

export function extractResponseText(result: unknown): string | null {
  if (typeof result === "string") {
    return result.length > 0 ? result : null;
  }
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const record = result as Record<string, unknown>;

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0] as { message?: { content?: unknown } };
    const content = firstChoice?.message?.content;
    if (typeof content === "string" && content.length > 0) {
      return content;
    }
  }

  const response = record.response;
  if (typeof response === "string") {
    return response.length > 0 ? response : null;
  }
  if (typeof response === "object" && response !== null) {
    const serialized = JSON.stringify(response);
    return serialized && serialized.length > 0 ? serialized : null;
  }
  return null;
}

/**
 * Provider results expose finish reasons under varying keys (choices[].finish_reason,
 * a top-level finish_reason/stop_reason, OpenAI-style usage). The shim forwards
 * whatever exists; the benchmark treats a missing value as unavailable.
 */
export function extractFinishReason(result: unknown): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const record = result as Record<string, unknown>;
  const direct =
    record.finish_reason ?? record.finishReason ?? record.stop_reason;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0] as {
      finish_reason?: unknown;
      finishReason?: unknown;
    };
    const value = firstChoice?.finish_reason ?? firstChoice?.finishReason;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function extractUsage(result: unknown): unknown {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const record = result as Record<string, unknown>;
  const usage = record.usage ?? record.usageMetadata ?? record.usage_metadata;
  if (usage !== undefined && usage !== null) {
    return usage;
  }
  return null;
}
