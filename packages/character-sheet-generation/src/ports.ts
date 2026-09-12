import type {
  SheetGenerationSectionPlanArtifact,
  SheetGenerationFieldsArtifact,
  SheetGenerationCalculationsArtifact,
  FieldCandidate,
  SectionPlanOutput,
  CalculationCandidate,
} from "./intermediate.js";
import type { SheetGenerationInputArtifact } from "./artifacts.js";
import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import type { CharacterSheetAuthoringMode } from "./authoring.js";

export type SheetGenerationStage =
  "section-plan" | "field-candidates" | "calculations";

/**
 * Provider-agnostic text-generation port for sheet stages. `system` carries
 * trusted instructions only; `user` carries the canonical RulesContext-derived
 * data. Structured parsing and validation happen in the domain on the raw text,
 * so a provider that ignores the schema gate cannot feed an invalid sheet.
 */
export interface SheetGenerationPort {
  generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string>;
}

/**
 * Narrow Level-3 name port used only for missing character names. `system`
 * carries trusted instructions; `user` carries mode and character intent only.
 * The deterministic construction phase owns bounded retries and fails visibly
 * on provider unavailability or persistently invalid output. There is no wider
 * Level-3 model-spec contract today.
 */
export interface Level3NamePort {
  generateName(input: {
    mode: CharacterSheetAuthoringMode;
    system: string;
    user: string;
  }): Promise<string>;
}

/**
 * Narrow, standalone contract for converting raw `contextInstructions` into
 * validated proposals. It is intentionally separate from `SheetGenerationPort`
 * because the extraction feature is locally isolated in this iteration: no
 * production provider is wired yet, and the shared stage union must not grow.
 */
export interface InstructionExtractionPort {
  generate(args: { system: string; user: string }): Promise<string>;
}

export interface InstructionExtractionDeps {
  extractionPort: InstructionExtractionPort;
}

/**
 * Narrow, provider-agnostic port for rulebook sheet-field derivation. `system`
 * carries trusted instructions only; `user` carries RulesContext content. The
 * domain parses and deterministically validates the returned raw text against
 * the supplied RulesContext, so a provider cannot mint canonical keys, assign
 * authority, or fabricate evidence that survives the gate.
 */
export interface RulebookFieldDerivationPort {
  derive(args: { system: string; user: string }): Promise<string>;
}

/**
 * Generation-scoped temporary artifacts (R2). The domain writes the canonical
 * input, plan, per-section fields, calculations, and final spec here; D1
 * persists only operational metadata. Implementations MUST reject stale reads:
 * every artifact embeds the run identity that wrote it.
 */
export interface SheetArtifactPort {
  putInput(input: {
    analysisId: string;
    runId: string;
    rulesAnalysisRunId: string;
    ingestionId: string;
    context: RulesContext;
  }): Promise<void>;
  putSectionPlan(input: {
    analysisId: string;
    runId: string;
    plan: SectionPlanOutput;
  }): Promise<void>;
  putSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
    fields: readonly FieldCandidate[];
  }): Promise<void>;
  putCalculations(input: {
    analysisId: string;
    runId: string;
    calculations: readonly CalculationCandidate[];
  }): Promise<void>;
  putSpec(input: {
    analysisId: string;
    runId: string;
    spec: CharacterSheetSpec;
  }): Promise<void>;
  getInput(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationInputArtifact | null>;
  getSectionPlan(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationSectionPlanArtifact | null>;
  getSectionFields(input: {
    analysisId: string;
    runId: string;
    sectionKey: string;
  }): Promise<SheetGenerationFieldsArtifact | null>;
  getCalculations(input: {
    analysisId: string;
    runId: string;
  }): Promise<SheetGenerationCalculationsArtifact | null>;
  getSpec(input: {
    analysisId: string;
    runId: string;
  }): Promise<CharacterSheetSpec | null>;
  deleteRunArtifacts(input: {
    analysisId: string;
    runId: string;
  }): Promise<void>;
}
