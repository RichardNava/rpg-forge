import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import { z } from "zod";
import type {
  CharacterSheetAuthoringMode,
  NPCThreatLevel,
  OutputLocale,
  PCPortraitInput,
  VisualStyleKey,
} from "./authoring.js";
import { compileCharacterSheet, SheetCompileError } from "./compiler.js";
import { createDeterministicRandom, stableNameSeed } from "./deterministic.js";
import {
  CalculationCandidateSchema,
  FieldCandidateSchema,
  type CalculationCandidate,
  type FieldCandidate,
  type SectionPlanOutput,
} from "./intermediate.js";
import { MAX_CALCULATIONS, SHEET_GENERATION_RETRIES } from "./model.js";
import type { Level3NamePort } from "./ports.js";
import {
  buildCharacterNameSystemPrompt,
  buildCharacterNameUserPrompt,
} from "./prompt.js";
import {
  NormalizedSheetDefinitionSchema,
  SourceResolvedFieldSchema,
  type NormalizedSheetDefinition,
  type SheetFieldSourceProvenance,
  type SourceResolvedField,
} from "./source-resolution.js";

/**
 * Level-3 final construction. The standalone generator construction phase is
 * provider-free and deterministic except for one narrow case: a missing
 * character name goes through the Level-3 name port.
 *
 * Input is a NormalizedSheetDefinition and nothing else is authoritative for
 * which fields exist. SectionPlanOutput/FieldCandidate are used below ONLY as
 * deterministic internal compiler DTOs derived from that definition; no AI
 * SectionPlan and no AI FieldCandidates are involved.
 *
 * Presentation metadata (visualStyle, history, portrait) is accepted on the
 * input side but is never compiled into mechanics and never applied here; a
 * future dedicated presentation phase owns it.
 */

/** The single canonical identity key for the visible character-name field. */
export const CHARACTER_NAME_KEY = "character_name";

const CHARACTER_NAME_LABEL = "Character Name";
const CHARACTER_NAME_MAX_LENGTH = 256;

const IDENTITY_SECTION_KEY = "identity";
const ATTRIBUTES_SECTION_KEY = "attributes";

/**
 * Threat bias centers the seeded NPC value distribution. A generated value is
 * sampled deterministically inside an upper/lower window around the tier's
 * bias (see resolveNpcValue), so tiers keep a real skew while different seeds
 * still produce different in-bounds values. The window lets the boss tier hug
 * the top of the range without forcing `max` on every draw.
 */
const THREAT_BIAS: Record<NPCThreatLevel, number> = {
  weak: 0.25,
  ordinary: 0.5,
  dangerous: 0.75,
  elite: 0.9,
  boss: 1,
};
const NEUTRAL_THREAT_BIAS = 0.5;

/** Half-width of the sampled window around the tier bias (0..1 space). */
const THREAT_BIAS_WINDOW = 0.25;

/**
 * Determinism seed used when the caller supplies neither seed nor sheetId so
 * the standalone path stays reproducible across identical calls.
 */
const DEFAULT_VALUE_SEED = "template-backed";

export interface GenerateCharacterSheetSpecInput {
  /** Authoritative source of the sheet: mode, name intent, fields, provenance. */
  definition: NormalizedSheetDefinition;
  /**
   * Real RulesContext for rulebook provenance, or null for a genuinely
   * GUI-only sheet. A null context may never carry ruleIds on any field.
   */
  context: RulesContext | null;
  /** Narrow Level-3 provider used only when the character name is missing. */
  namePort: Level3NamePort;
  /** Authorized formulas; defaults to the empty list (zero formulas is valid). */
  calculations?: readonly CalculationCandidate[];
  outputLocale?: OutputLocale | null;
  /**
   * Sheet metadata identity. Required when `context` is null (GUI-only);
   * otherwise `context.analysisId` remains the identity unless supplied.
   */
  sheetId?: string;
  /**
   * Determinism seed for seeded NPC value population. Defaults to `sheetId`,
   * then to a fixed literal. The same seed reproduces the same in-bounds
   * values; different seeds vary them. Always ignored for PC sheets and for
   * explicit/fixed values. Never a `Math.random` source.
   */
  seed?: string;
  /**
   * Presentation-only input. Never alters mechanics, never invents fields, and
   * is not applied by this phase.
   */
  presentation?: {
    visualStyle?: VisualStyleKey | null;
    history?: string | null;
    portrait?: PCPortraitInput | null;
  } | null;
}

export type FinalConstructionFailure =
  | "invalid_definition"
  | "duplicate_character_name"
  | "conflicting_character_name"
  | "invalid_character_name"
  | "name_provider_unavailable"
  | "invalid_mechanical_value"
  | "unknown_calculation_field"
  | "invalid_calculation_target"
  | "calculated_value_conflict"
  | "invalid_calculation"
  | "compile_failed"
  | "invalid_spec";

export class FinalConstructionError extends Error {
  readonly reason: FinalConstructionFailure;
  readonly details: string;

  constructor(reason: FinalConstructionFailure, details: string) {
    super(details);
    this.name = "FinalConstructionError";
    this.reason = reason;
    this.details = details;
  }
}

/**
 * Corrected 2E boundary: NormalizedSheetDefinition -> CharacterSheetSpec.
 *
 * Field existence is owned entirely by the normalized definition. The compiler
 * DTOs (plan, per-section fields, calculations) are derived deterministically
 * from it, the deterministic shared compiler is reused unchanged, resolved
 * values are threaded through the existing `values` mechanism, and the final
 * spec is parsed and domain-validated before it leaves.
 */
export async function generateCharacterSheetSpec(
  input: GenerateCharacterSheetSpecInput,
): Promise<CharacterSheetSpec> {
  const parsedDefinition = NormalizedSheetDefinitionSchema.safeParse(
    input.definition,
  );
  if (!parsedDefinition.success) {
    throw new FinalConstructionError(
      "invalid_definition",
      `The normalized sheet definition is invalid: ${summarizeZodIssues(parsedDefinition.error.issues)}`,
    );
  }
  const definition = parsedDefinition.data;
  const authoringMode = definition.mode;
  const compiledMode: "player" | "npc" =
    authoringMode === "pc" ? "player" : "npc";

  const resolvedName = await resolveCharacterName({
    definition,
    mode: authoringMode,
    context: input.context,
    namePort: input.namePort,
  });

  const calculations = validateCalculations(input.calculations);
  const promotionKeys = new Set(calculations.map((candidate) => candidate.key));
  const fieldsByKey = new Map(
    definition.fields.map((field) => [field.canonicalKey, field]),
  );
  for (const key of promotionKeys) {
    const target = fieldsByKey.get(key);
    if (target === undefined) {
      throw new FinalConstructionError(
        "unknown_calculation_field",
        `Calculation key "${key}" does not match any field of the normalized definition.`,
      );
    }
    if (target.category !== "mechanical") {
      throw new FinalConstructionError(
        "invalid_calculation_target",
        `Calculation key "${key}" targets identity field "${target.label}"; formulas may only derive mechanical fields.`,
      );
    }
    if (target.explicitValue !== null && target.explicitValue !== undefined) {
      throw new FinalConstructionError(
        "calculated_value_conflict",
        `Field "${target.label}" carries an explicit value and is also marked calculated; a derived field must not hold a direct value.`,
      );
    }
  }

  // Template-declared sections keep their template order; every field is
  // assigned to exactly one section: its declared section when present,
  // otherwise a deterministic category fallback. A fallback key that coincides
  // with a declared section joins that declared section instead.
  const declaredSections = definition.sections;
  const declaredByKey = new Map(
    declaredSections.map((section) => [section.key, section]),
  );

  const sectionKeyFor = (field: SourceResolvedField): string => {
    if (field.sectionKey !== undefined && declaredByKey.has(field.sectionKey)) {
      return field.sectionKey;
    }
    return field.category === "identity"
      ? IDENTITY_SECTION_KEY
      : ATTRIBUTES_SECTION_KEY;
  };

  const fieldsBySectionKey = new Map<string, SourceResolvedField[]>();
  const addToSection = (key: string, field: SourceResolvedField): void => {
    const bucket = fieldsBySectionKey.get(key);
    if (bucket === undefined) {
      fieldsBySectionKey.set(key, [field]);
    } else {
      bucket.push(field);
    }
  };

  addToSection(sectionKeyFor(resolvedName.field), resolvedName.field);
  for (const field of definition.fields) {
    if (field.canonicalKey === CHARACTER_NAME_KEY) {
      continue;
    }
    addToSection(sectionKeyFor(field), field);
  }

  const declaredKeys = new Set(declaredByKey.keys());
  const orderedKeys = [
    ...declaredSections
      .map((section) => section.key)
      .filter((key) => fieldsBySectionKey.has(key)),
    ...[...fieldsBySectionKey.keys()].filter((key) => !declaredKeys.has(key)),
  ];

  const fieldsBySection = new Map<string, FieldCandidate[]>();
  const sections: SectionPlanOutput["sections"] = [];
  for (const key of orderedKeys) {
    const sourceFields = fieldsBySectionKey.get(key)!;
    const declared = declaredByKey.get(key);
    fieldsBySection.set(
      key,
      sourceFields.map((field) =>
        toCompilerCandidate(field, promotionKeys.has(field.canonicalKey)),
      ),
    );
    sections.push(
      buildSection(
        key,
        sourceFields,
        input.outputLocale,
        declared?.title,
        declared?.purpose,
      ),
    );
  }

  const values = buildFieldValues({
    definition,
    nameValue: resolvedName.value,
    promotionKeys,
    seed: input.seed ?? input.sheetId ?? DEFAULT_VALUE_SEED,
  });

  let compiled: CharacterSheetSpec;
  try {
    compiled = compileCharacterSheet({
      context: input.context,
      plan: { mode: compiledMode, sections },
      fieldsBySection,
      calculations,
      ...(input.sheetId === undefined ? {} : { sheetId: input.sheetId }),
    });
  } catch (error) {
    if (error instanceof SheetCompileError) {
      throw new FinalConstructionError("compile_failed", error.details);
    }
    throw error;
  }

  const spec = parseSpec({
    ...compiled,
    metadata: {
      ...compiled.metadata,
      title: compiledMode === "npc" ? "NPC Sheet" : "Character Sheet",
      locale: input.outputLocale ?? null,
    },
    values,
  });

  const domain = validateCharacterSheetSpecDomain(spec, input.context);
  if (!domain.valid) {
    throw new FinalConstructionError(
      "invalid_spec",
      `The compiled character sheet failed domain validation: ${domain.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  return spec;
}

interface ResolvedCharacterName {
  field: SourceResolvedField;
  value: string;
}

async function resolveCharacterName(input: {
  definition: NormalizedSheetDefinition;
  mode: CharacterSheetAuthoringMode;
  context: RulesContext | null;
  namePort: Level3NamePort;
}): Promise<ResolvedCharacterName> {
  const existing = input.definition.fields.filter(
    (field) => field.canonicalKey === CHARACTER_NAME_KEY,
  );
  if (existing.length > 1) {
    throw new FinalConstructionError(
      "duplicate_character_name",
      "More than one field carries the canonical character_name identity.",
    );
  }

  const current = existing[0];
  const supplied = input.definition.characterName ?? null;

  if (current === undefined) {
    if (supplied === null) {
      const generated = await generateCharacterName(input);
      assertValidCharacterName(generated);
      return {
        field: mintNameField(generated, ["ai-default"]),
        value: generated,
      };
    }
    assertValidCharacterName(supplied);
    return { field: mintNameField(supplied, ["gui"]), value: supplied };
  }

  const currentText =
    typeof current.explicitValue === "string" ? current.explicitValue : null;

  if (supplied !== null) {
    if (currentText !== null && currentText !== supplied) {
      throw new FinalConstructionError(
        "conflicting_character_name",
        `The normalized character name "${supplied}" conflicts with the existing character_name field value "${currentText}".`,
      );
    }
    assertValidCharacterName(supplied);
    return {
      field: { ...current, explicitValue: supplied },
      value: supplied,
    };
  }

  if (currentText !== null) {
    assertValidCharacterName(currentText);
    return { field: current, value: currentText };
  }

  const generated = await generateCharacterName(input);
  assertValidCharacterName(generated);
  return {
    field: {
      ...current,
      explicitValue: generated,
      provenance: withAiDefaultOrigin(current.provenance),
    },
    value: generated,
  };
}

async function generateCharacterName(input: {
  mode: CharacterSheetAuthoringMode;
  context: RulesContext | null;
  namePort: Level3NamePort;
}): Promise<string> {
  const system = buildCharacterNameSystemPrompt();
  const user = buildCharacterNameUserPrompt({
    mode: input.mode,
    context: input.context,
  });

  let lastError =
    "The Level-3 name provider returned nothing usable for the character name.";
  for (let attempt = 0; attempt < SHEET_GENERATION_RETRIES; attempt += 1) {
    let raw: string;
    try {
      raw = await input.namePort.generateName({
        mode: input.mode,
        system,
        user,
      });
    } catch {
      throw new FinalConstructionError(
        "name_provider_unavailable",
        "The Level-3 name provider is unavailable.",
      );
    }
    const value = raw.trim();
    if (value.length === 0) {
      lastError = "The Level-3 name provider returned a blank name.";
      continue;
    }
    if (value.length > CHARACTER_NAME_MAX_LENGTH) {
      lastError = `The Level-3 name provider returned a name longer than ${CHARACTER_NAME_MAX_LENGTH} characters.`;
      continue;
    }
    return value;
  }

  throw new FinalConstructionError("invalid_character_name", lastError);
}

function assertValidCharacterName(value: string): void {
  if (value.trim().length === 0) {
    throw new FinalConstructionError(
      "invalid_character_name",
      "A character name must not be blank.",
    );
  }
  if (value.length > CHARACTER_NAME_MAX_LENGTH) {
    throw new FinalConstructionError(
      "invalid_character_name",
      `A character name may contain at most ${CHARACTER_NAME_MAX_LENGTH} characters.`,
    );
  }
}

function mintNameField(
  value: string,
  origins: SheetFieldSourceProvenance["origins"],
): SourceResolvedField {
  return SourceResolvedFieldSchema.parse({
    canonicalKey: CHARACTER_NAME_KEY,
    label: CHARACTER_NAME_LABEL,
    category: "identity",
    explicitValue: value,
    provenance: { origins },
  });
}

function withAiDefaultOrigin(
  provenance: SheetFieldSourceProvenance,
): SheetFieldSourceProvenance {
  return provenance.origins.includes("ai-default")
    ? provenance
    : { ...provenance, origins: [...provenance.origins, "ai-default"] };
}

function buildSection(
  key: string,
  sourceFields: readonly SourceResolvedField[],
  locale: string | null | undefined,
  titleOverride?: string,
  purposeOverride?: string,
): SectionPlanOutput["sections"][number] {
  const spanish = isSpanishLocale(locale);
  return {
    key,
    title:
      titleOverride ??
      (key === IDENTITY_SECTION_KEY
        ? spanish
          ? "Identidad"
          : "Identity"
        : key === ATTRIBUTES_SECTION_KEY
          ? spanish
            ? "Atributos"
            : "Attributes"
          : key),
    purpose:
      purposeOverride ??
      (key === IDENTITY_SECTION_KEY
        ? "The character's visible identity: name and personal traits."
        : key === ATTRIBUTES_SECTION_KEY
          ? "The character's mechanical attributes."
          : "The sheet's presented fields."),
    ruleIds: unionRuleIds(sourceFields),
  };
}

function unionRuleIds(fields: readonly SourceResolvedField[]): string[] {
  const seen = new Set<string>();
  const ruleIds: string[] = [];
  for (const field of fields) {
    for (const ruleId of field.provenance.ruleIds ?? []) {
      if (!seen.has(ruleId)) {
        seen.add(ruleId);
        ruleIds.push(ruleId);
      }
    }
  }
  return ruleIds;
}

function toCompilerCandidate(
  field: SourceResolvedField,
  isCalculated: boolean,
): FieldCandidate {
  if (isCalculated) {
    return FieldCandidateSchema.parse({
      key: field.canonicalKey,
      label: field.label,
      ruleIds: field.provenance.ruleIds ?? [],
      type: "calculated",
    });
  }
  const ruleIds = field.provenance.ruleIds ?? [];
  if (field.canonicalKey === CHARACTER_NAME_KEY) {
    return FieldCandidateSchema.parse({
      key: field.canonicalKey,
      label: field.label,
      ruleIds,
      type: "text",
      maxLength: CHARACTER_NAME_MAX_LENGTH,
    });
  }
  const type = compilerTypeFor(field);
  if (type === "textarea") {
    return FieldCandidateSchema.parse({
      key: field.canonicalKey,
      label: field.label,
      ruleIds,
      type: "textarea",
    });
  }
  if (type === "checkbox") {
    return FieldCandidateSchema.parse({
      key: field.canonicalKey,
      label: field.label,
      ruleIds,
      type: "checkbox",
    });
  }
  if (type === "text") {
    return FieldCandidateSchema.parse({
      key: field.canonicalKey,
      label: field.label,
      ruleIds,
      type: "text",
    });
  }
  const range = field.permittedValueRange;
  return FieldCandidateSchema.parse({
    key: field.canonicalKey,
    label: field.label,
    ruleIds,
    type: "number",
    ...(range === undefined ? {} : { min: range.min, max: range.max }),
  });
}

/**
 * Maps a template-proposed kind onto the compiler type only when the template
 * contract carries enough payload to compile it faithfully. Payload-free kinds
 * (text, number, textarea, checkbox) map directly; payload-requiring kinds
 * (radio, select, multiselect, rating, resource, list, table, calculated,
 * image) fall back to the category base type until the template schema grows
 * their payload — they are never silently invented.
 */
function compilerTypeFor(
  field: SourceResolvedField,
): "text" | "number" | "textarea" | "checkbox" {
  switch (field.kind) {
    case undefined:
      return field.category === "identity" ? "text" : "number";
    case "text":
      return "text";
    case "number":
      return "number";
    case "textarea":
      return "textarea";
    case "checkbox":
      return "checkbox";
    default:
      return field.category === "identity" ? "text" : "number";
  }
}

function buildFieldValues(input: {
  definition: NormalizedSheetDefinition;
  nameValue: string;
  promotionKeys: ReadonlySet<string>;
  seed: string;
}): Record<string, string | number> {
  const threat = input.definition.npc?.threat ?? null;
  const values: Record<string, string | number> = {
    [CHARACTER_NAME_KEY]: input.nameValue,
  };

  for (const field of input.definition.fields) {
    if (field.canonicalKey === CHARACTER_NAME_KEY) {
      continue;
    }
    if (field.category === "identity") {
      if (typeof field.explicitValue === "string") {
        values[field.canonicalKey] = field.explicitValue;
      }
      continue;
    }
    if (input.promotionKeys.has(field.canonicalKey)) {
      continue;
    }
    const value =
      input.definition.mode === "pc"
        ? resolvePcValue(field)
        : resolveNpcValue(field, threat, input.seed);
    if (value !== null) {
      values[field.canonicalKey] = value;
    }
  }

  return values;
}

function resolvePcValue(field: SourceResolvedField): number | null {
  if (typeof field.explicitValue === "number") {
    assertNumericValueInRange(field, field.explicitValue);
    return field.explicitValue;
  }
  if (field.explicitValue === null || field.explicitValue === undefined) {
    return null;
  }
  throw new FinalConstructionError(
    "invalid_mechanical_value",
    `Mechanical field "${field.label}" carries a non-numeric explicit value and cannot be compiled.`,
  );
}

function resolveNpcValue(
  field: SourceResolvedField,
  threat: NPCThreatLevel | null,
  seed: string,
): number | null {
  if (typeof field.explicitValue === "number") {
    assertNumericValueInRange(field, field.explicitValue);
    return field.explicitValue;
  }
  if (field.explicitValue !== null && field.explicitValue !== undefined) {
    throw new FinalConstructionError(
      "invalid_mechanical_value",
      `Mechanical field "${field.label}" carries a non-numeric explicit value and cannot be compiled.`,
    );
  }
  const range = field.permittedValueRange;
  if (range === undefined) {
    return null;
  }
  if (range.min === range.max) {
    return range.min;
  }

  const bias = threat === null ? NEUTRAL_THREAT_BIAS : THREAT_BIAS[threat];
  // Independent deterministic per-field stream: mixing the field identity and
  // threat into the seed keeps values stable under field reordering and
  // reproducible across runs, while different seeds vary the sampled value.
  const random = createDeterministicRandom(
    stableNameSeed(`${seed}|${threat ?? "none"}|${field.canonicalKey}`),
  );
  // Sample inside a window centered on the tier bias: every tier keeps its
  // skew (the boss tier hugs the top of the range) but each draw still varies
  // with the seed, so no tier is hard-coded to an exact value or to `max`.
  const low = Math.max(0, bias - THREAT_BIAS_WINDOW);
  const high = Math.min(1, bias + THREAT_BIAS_WINDOW);
  const t = low + random() * (high - low);
  const raw = range.min + t * (range.max - range.min);
  const value = Math.round(raw);
  return Math.min(range.max, Math.max(range.min, value));
}

function assertNumericValueInRange(
  field: SourceResolvedField,
  value: number,
): void {
  const range = field.permittedValueRange;
  if (range === undefined) {
    return;
  }
  if (value < range.min || value > range.max) {
    throw new FinalConstructionError(
      "invalid_mechanical_value",
      `Explicit value ${value} of field "${field.label}" falls outside its permitted range ${range.min}..${range.max} and is never clipped.`,
    );
  }
}

function validateCalculations(
  calculations: readonly CalculationCandidate[] | undefined,
): CalculationCandidate[] {
  const incoming = calculations ?? [];
  if (incoming.length > MAX_CALCULATIONS) {
    throw new FinalConstructionError(
      "invalid_calculation",
      `A sheet accepts at most ${MAX_CALCULATIONS} calculation candidates.`,
    );
  }

  const seen = new Set<string>();
  const validated: CalculationCandidate[] = [];
  for (const candidate of incoming) {
    const parsed = CalculationCandidateSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new FinalConstructionError(
        "invalid_calculation",
        `A calculation candidate failed validation (including the AST depth bound): ${summarizeZodIssues(parsed.error.issues)}`,
      );
    }
    if (seen.has(parsed.data.key)) {
      throw new FinalConstructionError(
        "invalid_calculation",
        `Calculation key "${parsed.data.key}" repeats.`,
      );
    }
    seen.add(parsed.data.key);
    validated.push(parsed.data);
  }
  return validated;
}

function isSpanishLocale(locale: string | null | undefined): boolean {
  return (
    locale !== null &&
    locale !== undefined &&
    locale.toLowerCase().startsWith("es")
  );
}

function parseSpec(candidate: unknown): CharacterSheetSpec {
  try {
    return CharacterSheetSpecSchema.parse(candidate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new FinalConstructionError(
        "invalid_spec",
        `The compiled character sheet failed structural validation: ${summarizeZodIssues(error.issues)}`,
      );
    }
    throw error;
  }
}

function summarizeZodIssues(issues: readonly { message: string }[]): string {
  const messages = issues.slice(0, 3).map((issue) => issue.message);
  return messages.length === 0 ? "Invalid input." : messages.join("; ");
}
