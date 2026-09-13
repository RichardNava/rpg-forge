import type { CharacterSheetTemplate } from "@repo/character-sheet-template";
import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import type {
  CharacterSheetGenerationRequest,
  OutputLocale,
} from "./authoring.js";
import {
  createDeterministicLevel3NamePort,
  type DeterministicLocalNamePort,
} from "./deterministic-local-name.js";
import {
  generateCharacterSheetSpec,
  type GenerateCharacterSheetSpecInput,
} from "./final-construction.js";
import { normalizeGuiSource } from "./gui-normalization.js";
import type { ProposedGenerationInstruction } from "./instructions.js";
import type { Level3NamePort } from "./ports.js";
import type { GenerationConflict } from "./source-resolution.js";
import {
  normalizeTemplateFields,
  overlayTemplateWithGui,
} from "./template-normalization.js";
import {
  resolveUnifiedSheetDefinition,
  type UnifiedSheetGenerationResult,
} from "./unified-generation.js";

/**
 * Template-backed generation service deps. The name port is optional: by
 * default the standalone template-backed flow uses the seeded, locale-aware,
 * AI-free deterministic name source, so a public standalone generator never
 * depends on a model for a usable character name.
 */
export interface TemplateBackedGenerationDeps {
  deterministicNames?: DeterministicLocalNamePort;
  namePort?: Level3NamePort;
}

export interface TemplateBackedSheetInput {
  /** Validated extracted template; the authority for which fields exist. */
  template: CharacterSheetTemplate;
  /** Validated GUI authoring request; supplies values, bounds and mode. */
  request: CharacterSheetGenerationRequest;
  /** Real RulesContext for provenance, or null for a genuine GUI-only sheet. */
  context?: RulesContext | null;
  instructions?: readonly ProposedGenerationInstruction[];
  /** Sheet identity for GUI-only construction and name-seed fallback. */
  sheetId?: string;
  outputLocale?: OutputLocale | null;
  /**
   * Determinism seed for the local name source and the seeded NPC value
   * population (defaults to sheetId). The same seed reproduces the same
   * values; different seeds vary eligible values within their bounds.
   */
  seed?: string;
}

export type TemplateBackedSheetOutcome =
  | {
      kind: "ok";
      definition: UnifiedSheetGenerationResult;
      spec: CharacterSheetSpec;
      templateConflicts: readonly GenerationConflict[];
      overlayConflicts: readonly GenerationConflict[];
    }
  | { kind: "template_mode_mismatch" };

/**
 * Full template-backed generation: template normalization → GUI normalization
 * → template/GUI overlay → unified source resolution (Level-2 + Level-1) →
 * deterministic final construction (Level-3).
 *
 * The task summary scheduled this as "template-service wiring (definition +
 * spec generation)". To avoid duplicating the final-construction contract here,
 * spec generation delegates to the already-validated shared Level-3 phase.
 */
export async function generateTemplateBackedSheet(
  input: TemplateBackedSheetInput,
  deps: TemplateBackedGenerationDeps = {},
): Promise<TemplateBackedSheetOutcome> {
  const templateNormalization = normalizeTemplateFields(
    input.template,
    input.request.mode,
  );
  if (
    templateNormalization.conflicts.some(
      (conflict) => conflict.code === "TEMPLATE_MODE_MISMATCH",
    )
  ) {
    return { kind: "template_mode_mismatch" };
  }

  const gui = normalizeGuiSource(input.request);

  const overlay = overlayTemplateWithGui({
    templateFields: templateNormalization.fields,
    guiFields: gui.fields,
  });

  const definition = resolveUnifiedSheetDefinition({
    mode: gui.mode,
    characterName: gui.characterName,
    ...(gui.npc !== undefined ? { npc: gui.npc } : {}),
    guiFields: overlay.fields,
    sections: input.template.sections.map((section) => ({
      key: section.key,
      title: section.title,
      ...(section.purpose === undefined ? {} : { purpose: section.purpose }),
    })),
    sourceConflicts: [...templateNormalization.conflicts, ...overlay.conflicts],
    instructions: input.instructions ?? [],
  });

  const namePort =
    deps.namePort ??
    createDeterministicLevel3NamePort({
      seed: input.seed ?? input.sheetId ?? "template-backed",
      ...(input.outputLocale === undefined || input.outputLocale === null
        ? {}
        : { locale: input.outputLocale }),
      ...(deps.deterministicNames === undefined
        ? {}
        : { port: deps.deterministicNames }),
    });

  const specInput: GenerateCharacterSheetSpecInput = {
    definition: definition.definition,
    context: input.context ?? null,
    namePort,
    ...(input.outputLocale === undefined
      ? {}
      : { outputLocale: input.outputLocale }),
    ...(input.sheetId === undefined ? {} : { sheetId: input.sheetId }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  };
  const spec = await generateCharacterSheetSpec(specInput);

  return {
    kind: "ok",
    definition,
    spec,
    templateConflicts: templateNormalization.conflicts,
    overlayConflicts: overlay.conflicts,
  };
}
