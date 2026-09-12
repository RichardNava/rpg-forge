import type { RulesContext } from "@repo/rules-context";
import type { CharacterSheetAuthoringMode } from "./authoring.js";
import type { CharacterSheetGenerationRequest } from "./authoring.js";
import { normalizeGuiSource } from "./gui-normalization.js";
import type { ProposedGenerationInstruction } from "./instructions.js";
import { SHEET_GENERATION_RETRIES } from "./model.js";
import type {
  InstructionExtractionPort,
  RulebookFieldDerivationPort,
} from "./ports.js";
import {
  appendValidationFeedback,
  buildRulebookDerivationSystemPrompt,
  buildRulebookDerivationUserPrompt,
} from "./prompt.js";
import {
  parseRulebookDerivedDefinition,
  validateRulebookDerivedDefinition,
  type RulebookDerivationValidationResult,
} from "./rulebook-derivation.js";
import type {
  GenerationConflict,
  SourceResolvedField,
} from "./source-resolution.js";
import {
  resolveUnifiedSheetDefinition,
  type UnifiedSheetGenerationResult,
} from "./unified-generation.js";

/**
 * A narrow provider-agnostic service dependency. `extractionPort` is reserved
 * for a later provider-qualification harness and is deliberately never invoked
 * by the 2D path: contextInstructions stay deferred, and structured
 * instructions reach the deterministic engine directly.
 */
export interface UnifiedGenerationDeps {
  derivationPort: RulebookFieldDerivationPort;
  extractionPort?: InstructionExtractionPort;
}

/**
 * Deterministic record of the rulebook-derivation side of a generation: how
 * many provider calls actually happened, which validated fields entered source
 * resolution, and which evidence rejections surfaced as conflicts.
 */
export interface RulebookDerivationTrace {
  calls: number;
  fields: readonly SourceResolvedField[];
  conflicts: readonly GenerationConflict[];
}

export type UnifiedSheetGenerationOutcome =
  | {
      kind: "ok";
      result: UnifiedSheetGenerationResult;
      derivation: RulebookDerivationTrace;
    }
  | { kind: "derivation_unavailable" }
  | { kind: "invalid_proposal"; message: string };

/**
 * Unified 2D entry point. The GUI authoring request is normalized
 * deterministically; an optional READY RulesContext triggers exactly one
 * derivation attempt sequence (no RulesContext means the derivation port
 * receives zero calls). Validated rulebook fields then merge with the GUI
 * source in `resolveUnifiedSheetDefinition`.
 */
export async function generateNormalizedSheet(
  input: {
    request: CharacterSheetGenerationRequest;
    context: RulesContext | null;
    instructions?: readonly ProposedGenerationInstruction[];
  },
  deps: UnifiedGenerationDeps,
): Promise<UnifiedSheetGenerationOutcome> {
  const gui = normalizeGuiSource(input.request);
  const instructions = input.instructions ?? [];

  const trace: RulebookDerivationTrace = {
    calls: 0,
    fields: [],
    conflicts: [],
  };

  if (input.context !== null) {
    const derived = await deriveRulebookFields({
      context: input.context,
      mode: gui.mode,
      port: deps.derivationPort,
    });
    if (derived.kind === "unavailable") {
      return { kind: "derivation_unavailable" };
    }
    if (derived.kind === "invalid_proposal") {
      return { kind: "invalid_proposal", message: derived.message };
    }
    trace.calls = derived.calls;
    trace.fields = derived.details.fields;
    trace.conflicts = derived.details.conflicts;
  }

  const result = resolveUnifiedSheetDefinition({
    mode: gui.mode,
    characterName: gui.characterName,
    ...(gui.npc !== undefined ? { npc: gui.npc } : {}),
    guiFields: gui.fields,
    rulebookFields: trace.fields,
    sourceConflicts: trace.conflicts,
    instructions,
  });

  return { kind: "ok", result, derivation: trace };
}

type DerivationOutcome =
  | { kind: "ok"; calls: number; details: RulebookDerivationValidationResult }
  | { kind: "unavailable" }
  | { kind: "invalid_proposal"; message: string };

async function deriveRulebookFields(input: {
  context: RulesContext;
  mode: CharacterSheetAuthoringMode;
  port: RulebookFieldDerivationPort;
}): Promise<DerivationOutcome> {
  const system = buildRulebookDerivationSystemPrompt();
  let user = buildRulebookDerivationUserPrompt({
    context: input.context,
    mode: input.mode,
  });

  let lastError = "The model response was not valid JSON.";
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await input.port.derive({ system, user });
    } catch {
      return { kind: "unavailable" };
    }
    const parsed = parseRulebookDerivedDefinition(raw);
    if (!parsed.ok) {
      lastError = parsed.error;
      user = appendValidationFeedback(user, parsed.error);
      continue;
    }
    return {
      kind: "ok",
      calls: attempt + 1,
      details: validateRulebookDerivedDefinition({
        proposal: parsed.definition,
        context: input.context,
        mode: input.mode,
      }),
    };
  }

  return { kind: "invalid_proposal", message: lastError };
}
