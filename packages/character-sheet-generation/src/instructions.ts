import { z } from "zod";
import { AuthoredFieldLabelSchema, CharacterNameSchema } from "./authoring.js";
import { MAX_TOTAL_FIELDS } from "./model.js";
import { combineDuplicate, mergeProvenance } from "./source-merge.js";
import {
  CanonicalFieldKeySchema,
  canonicalizeFieldLabel,
  ExplicitSheetOverrideSchema,
  FieldCategorySchema,
  GenerationConflictSchema,
  MAX_CONFLICT_SOURCE_LABELS,
  MAX_EXPLICIT_INPUT_OVERRIDES,
  MAX_GENERATION_CONFLICTS,
  NormalizedSheetDefinitionSchema,
  ProposedSheetOverrideSchema,
  SourceResolvedFieldSchema,
  type ExplicitSheetOverride,
  type FieldCategory,
  type GenerationConflict,
  type GenerationConflictCode,
  type NormalizedSheetDefinition,
  type ProposedSheetOverride,
  type SourceResolvedField,
} from "./source-resolution.js";

export const MAX_INSTRUCTION_NAME_CHARS = 256;
export const MAX_PORTRAIT_PROMPT_CHARS = 2_000;
export const MAX_PORTRAIT_DESCRIPTION_CHARS = 5_000;

/**
 * A bounded natural-language intention for an NPC portrait. It is always
 * requested explicitly by an instruction; no trait, threat, style, rulebook
 * content or authoring field implies a portrait on its own.
 */
export const NpcPortraitIntentSchema = z
  .strictObject({
    prompt: z
      .string()
      .min(1)
      .max(MAX_PORTRAIT_PROMPT_CHARS)
      .regex(/\S/)
      .optional(),
    description: z
      .string()
      .min(1)
      .max(MAX_PORTRAIT_DESCRIPTION_CHARS)
      .regex(/\S/)
      .optional(),
    requestedVia: z.literal("contextInstructions"),
  })
  .superRefine((intent, context) => {
    if (intent.prompt === undefined && intent.description === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "A portrait intent requires a prompt or a description.",
      });
    }
  });
export type NpcPortraitIntent = z.infer<typeof NpcPortraitIntentSchema>;

/**
 * A structured, machine-readable explicit instruction. The AI proposes only
 * these shapes; no raw contextInstructions text is ever parsed by the engine.
 * The field branch reuses the exact ProposedSheetOverride vocabulary.
 */
export const ProposedGenerationInstructionSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("field"),
    override: ProposedSheetOverrideSchema,
  }),
  z.strictObject({
    op: z.literal("set_character_name"),
    value: z
      .string()
      .max(MAX_INSTRUCTION_NAME_CHARS)
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, {
        message:
          "A character name instruction must name a non-empty character.",
      }),
  }),
  z.strictObject({
    op: z.literal("request_npc_portrait"),
    intent: NpcPortraitIntentSchema,
  }),
]);
export type ProposedGenerationInstruction = z.infer<
  typeof ProposedGenerationInstructionSchema
>;

/**
 * The resolved form of an instruction after deterministic target resolution.
 * Field operations carry canonical keys, exactly like ExplicitSheetOverride;
 * the character name is trimmed and verified non-empty.
 */
export const ValidatedGenerationInstructionSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("field"),
    override: ExplicitSheetOverrideSchema,
  }),
  z.strictObject({
    op: z.literal("set_character_name"),
    characterName: z.string().min(1).max(MAX_INSTRUCTION_NAME_CHARS),
  }),
  z.strictObject({
    op: z.literal("request_npc_portrait"),
    intent: NpcPortraitIntentSchema,
  }),
]);
export type ValidatedGenerationInstruction = z.infer<
  typeof ValidatedGenerationInstructionSchema
>;

/**
 * Key-remap audit record produced by REPLACE. It says only that the field
 * formerly known as `fromKey` now lives under `toKey`; it never rewrites
 * formulas, so mechanical expressions keep targeting the original structural
 * identity until a downstream phase makes its own remap decision.
 */
export const KeyRemapSchema = z.strictObject({
  category: FieldCategorySchema,
  fromKey: CanonicalFieldKeySchema,
  toKey: CanonicalFieldKeySchema,
  sourceLabel: AuthoredFieldLabelSchema,
  replacementLabel: AuthoredFieldLabelSchema,
});
export type KeyRemap = z.infer<typeof KeyRemapSchema>;

export const RejectedGenerationInstructionSchema = z.strictObject({
  instruction: ProposedGenerationInstructionSchema,
  conflict: GenerationConflictSchema,
});
export type RejectedGenerationInstruction = z.infer<
  typeof RejectedGenerationInstructionSchema
>;

export const GenerationInstructionApplicationResultSchema = z.strictObject({
  definition: NormalizedSheetDefinitionSchema,
  appliedInstructions: z.array(ValidatedGenerationInstructionSchema),
  rejectedInstructions: z
    .array(RejectedGenerationInstructionSchema)
    .default([]),
  conflicts: z.array(GenerationConflictSchema).max(MAX_GENERATION_CONFLICTS),
  keyRemaps: z.array(KeyRemapSchema).default([]),
  npcPortraitIntent: NpcPortraitIntentSchema.optional(),
});
export type GenerationInstructionApplicationResult = z.infer<
  typeof GenerationInstructionApplicationResultSchema
>;

type Rejection = { conflict: GenerationConflict };
type FieldOutcome = { applied?: ExplicitSheetOverride; rejected?: Rejection };

type TargetResolution =
  | { kind: "found"; field: SourceResolvedField; index: number }
  | { kind: "missing" }
  | { kind: "ambiguous"; labels: string[] };

function makeConflict(
  code: GenerationConflictCode,
  canonicalKey: string | null,
  sourceLabels: readonly string[],
  message: string,
): GenerationConflict {
  return GenerationConflictSchema.parse({
    code,
    canonicalKey,
    message,
    sourceLabels: sourceLabels
      .filter((label, index, all) => all.indexOf(label) === index)
      .slice(0, MAX_CONFLICT_SOURCE_LABELS),
  });
}

/**
 * Deterministic target resolution against the working field set. A reference
 * label is canonicalized, then followed through every REPLACE remap recorded so
 * far, so a field keeps being reachable under its old label after a replace.
 * A field is also reachable through its currently stored display label, so a
 * RENAME stays addressable by its new name. Zero matches are MISSING, more
 * than one match is AMBIGUOUS; no fuzzy, semantic or embedding matching ever
 * participates.
 */
function resolveTarget(
  fields: readonly SourceResolvedField[],
  remaps: readonly KeyRemap[],
  label: string,
  category: FieldCategory | undefined,
): TargetResolution {
  const key = canonicalizeFieldLabel(label);

  let refKey = key;
  const visited = new Set<string>();
  while (true) {
    const remap = remaps.find((candidate) => candidate.fromKey === refKey);
    if (remap === undefined || visited.has(refKey)) {
      break;
    }
    visited.add(refKey);
    refKey = remap.toKey;
  }

  const matches: { field: SourceResolvedField; index: number }[] = [];
  fields.forEach((field, index) => {
    const keyMatch = field.canonicalKey === refKey;
    const labelMatch = canonicalizeFieldLabel(field.label) === key;
    if (!keyMatch && !labelMatch) {
      return;
    }
    if (category !== undefined && field.category !== category) {
      return;
    }
    matches.push({ field, index });
  });

  if (matches.length === 0) {
    return { kind: "missing" };
  }
  if (matches.length === 1) {
    return {
      kind: "found",
      field: matches[0]!.field,
      index: matches[0]!.index,
    };
  }
  return {
    kind: "ambiguous",
    labels: matches.map((match) => match.field.label),
  };
}

/**
 * Applies a verified sequence of deterministic generation instructions to a
 * NormalizedSheetDefinition. The sequence is preserved in order; each
 * instruction is applied independently, so a rejected instruction never stops
 * the rest of the sequence and never removes prior applied work. Instructions
 * are the LEVEL-1 authority: they run above equal/additive LEVEL-2 sources and
 * can replace a LEVEL-2 name, value or range. They never fabricate rulebook
 * evidence, never rewrite formulas, and never silently destroy a conflicting
 * existing field.
 */
export function applyGenerationInstructions(
  definition: NormalizedSheetDefinition,
  proposed: readonly ProposedGenerationInstruction[],
): GenerationInstructionApplicationResult {
  if (proposed.length === 0) {
    return GenerationInstructionApplicationResultSchema.parse({
      definition,
      appliedInstructions: [],
      conflicts: definition.conflicts,
      keyRemaps: [],
    });
  }

  const fields: SourceResolvedField[] = definition.fields.map((field) => ({
    ...field,
  }));
  const remaps: KeyRemap[] = [];
  const applied: ValidatedGenerationInstruction[] = [];
  const rejected: RejectedGenerationInstruction[] = [];
  const newConflicts: GenerationConflict[] = [];
  const touchedKeys = new Set<string>();
  const overrides: ExplicitSheetOverride[] = definition.overrides.map(
    (override) => ({ ...override }),
  );
  const mode = definition.mode;
  let characterName = definition.characterName;
  let npcPortraitIntent: NpcPortraitIntent | undefined;

  function reject(conflict: GenerationConflict): FieldOutcome {
    return { rejected: { conflict } };
  }

  function applyFieldOverride(override: ProposedSheetOverride): FieldOutcome {
    if (overrides.length >= MAX_EXPLICIT_INPUT_OVERRIDES) {
      return reject(
        makeConflict(
          "INVALID_INSTRUCTION_CONTEXT",
          null,
          [overrideTargetLabel(override)],
          "The explicit override budget is exhausted; field instructions are rejected.",
        ),
      );
    }

    switch (override.op) {
      case "add":
        return applyAdd(override);
      case "remove":
        return applyRemove(override);
      case "rename":
        return applyRename(override);
      case "replace":
        return applyReplace(override);
      case "constrain":
        return applyConstrain(override);
      case "set_value":
        return applySetValue(override);
    }
  }

  function applyAdd(
    override: Extract<ProposedSheetOverride, { op: "add" }>,
  ): FieldOutcome {
    const key = canonicalizeFieldLabel(override.label);

    let category = override.category;
    if (category === undefined) {
      const sameKeyFields = fields.filter(
        (field) =>
          field.canonicalKey === key ||
          canonicalizeFieldLabel(field.label) === key,
      );
      const categories = new Set(sameKeyFields.map((field) => field.category));
      if (categories.size === 1) {
        category = [...categories][0]!;
      } else if (categories.size === 0) {
        if (typeof override.initialValue === "number") {
          category = "mechanical";
        } else if (typeof override.initialValue === "string") {
          category = "identity";
        }
      }
      if (category === undefined) {
        const labels =
          sameKeyFields.length > 0
            ? sameKeyFields.map((field) => field.label)
            : [override.label];
        return reject(
          makeConflict(
            "AMBIGUOUS_OVERRIDE_TARGET",
            key,
            labels,
            `Cannot determine the category of the added field "${override.label}".`,
          ),
        );
      }
    }

    if (category === "identity") {
      if (typeof override.initialValue === "number") {
        return reject(
          makeConflict(
            "INVALID_OVERRIDE_CONSTRAINTS",
            key,
            [override.label],
            "Identity traits carry textual values only.",
          ),
        );
      }
      if (override.permittedValueRange !== undefined) {
        return reject(
          makeConflict(
            "INVALID_OVERRIDE_CONSTRAINTS",
            key,
            [override.label],
            "Identity traits must not carry numeric bounds.",
          ),
        );
      }
    }

    const added: SourceResolvedField = {
      canonicalKey: key,
      label: override.label,
      category,
      explicitValue: override.initialValue ?? null,
      ...(override.permittedValueRange !== undefined
        ? { permittedValueRange: override.permittedValueRange }
        : {}),
      provenance: { origins: ["context-override"] },
    };

    const existingIndex = fields.findIndex(
      (field) => field.category === category && field.canonicalKey === key,
    );
    if (existingIndex !== -1) {
      const combined = combineDuplicate(fields[existingIndex]!, added);
      if (
        combined.conflict !== null &&
        combined.conflict.code !== "INVALID_CONSTRAINT_VALUE"
      ) {
        return reject(combined.conflict);
      }
      fields[existingIndex] = combined.field;
      touchedKeys.add(key);
      const validated: ExplicitSheetOverride = {
        op: "add",
        field: combined.field,
      };
      overrides.push(validated);
      return { applied: validated };
    }

    if (fields.length >= MAX_TOTAL_FIELDS) {
      return reject(
        makeConflict(
          "INVALID_INSTRUCTION_CONTEXT",
          key,
          [override.label],
          `Adding a field would exceed the total field limit of ${MAX_TOTAL_FIELDS}.`,
        ),
      );
    }

    fields.push(added);
    touchedKeys.add(key);
    const validated: ExplicitSheetOverride = { op: "add", field: added };
    overrides.push(validated);
    return { applied: validated };
  }

  function applyRemove(
    override: Extract<ProposedSheetOverride, { op: "remove" }>,
  ): FieldOutcome {
    const target = resolveTarget(
      fields,
      remaps,
      override.targetLabel,
      override.category,
    );
    if (target.kind === "missing") {
      return reject(
        makeConflict(
          "MISSING_OVERRIDE_TARGET",
          null,
          [override.targetLabel],
          `No field matches the target label "${override.targetLabel}".`,
        ),
      );
    }
    if (target.kind === "ambiguous") {
      return reject(
        makeConflict(
          "AMBIGUOUS_OVERRIDE_TARGET",
          null,
          target.labels,
          `Target label "${override.targetLabel}" is ambiguous across multiple fields.`,
        ),
      );
    }
    fields.splice(target.index, 1);
    touchedKeys.add(target.field.canonicalKey);
    const validated: ExplicitSheetOverride = {
      op: "remove",
      targetKey: target.field.canonicalKey,
    };
    overrides.push(validated);
    return { applied: validated };
  }

  function applyRename(
    override: Extract<ProposedSheetOverride, { op: "rename" }>,
  ): FieldOutcome {
    const target = resolveTarget(
      fields,
      remaps,
      override.sourceLabel,
      override.category,
    );
    if (target.kind === "missing") {
      return reject(
        makeConflict(
          "MISSING_OVERRIDE_TARGET",
          null,
          [override.sourceLabel, override.newLabel],
          `No field matches the source label "${override.sourceLabel}".`,
        ),
      );
    }
    if (target.kind === "ambiguous") {
      return reject(
        makeConflict(
          "AMBIGUOUS_OVERRIDE_TARGET",
          null,
          target.labels,
          `Source label "${override.sourceLabel}" is ambiguous across multiple fields.`,
        ),
      );
    }
    fields[target.index]!.label = override.newLabel;
    const validated: ExplicitSheetOverride = {
      op: "rename",
      sourceKey: target.field.canonicalKey,
      newLabel: override.newLabel,
    };
    overrides.push(validated);
    return { applied: validated };
  }

  function applyReplace(
    override: Extract<ProposedSheetOverride, { op: "replace" }>,
  ): FieldOutcome {
    const target = resolveTarget(
      fields,
      remaps,
      override.sourceLabel,
      override.category,
    );
    if (target.kind === "missing") {
      return reject(
        makeConflict(
          "MISSING_OVERRIDE_TARGET",
          null,
          [override.sourceLabel, override.replacementLabel],
          `No field matches the source label "${override.sourceLabel}".`,
        ),
      );
    }
    if (target.kind === "ambiguous") {
      return reject(
        makeConflict(
          "AMBIGUOUS_OVERRIDE_TARGET",
          null,
          target.labels,
          `Source label "${override.sourceLabel}" is ambiguous across multiple fields.`,
        ),
      );
    }

    const source = target.field;
    const replacementKey = canonicalizeFieldLabel(override.replacementLabel);
    if (replacementKey === source.canonicalKey) {
      return reject(
        makeConflict(
          "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
          source.canonicalKey,
          [source.label, override.replacementLabel],
          `The replacement label "${override.replacementLabel}" canonicalizes to the same key as the source field "${source.label}".`,
        ),
      );
    }

    const derived: SourceResolvedField = {
      canonicalKey: replacementKey,
      label: override.replacementLabel,
      category: source.category,
      explicitValue: source.explicitValue,
      ...(source.permittedValueRange !== undefined
        ? { permittedValueRange: source.permittedValueRange }
        : {}),
      ...(source.kind !== undefined ? { kind: source.kind } : {}),
      ...(source.sectionKey !== undefined ? { sectionKey: source.sectionKey } : {}),
      provenance: mergeProvenance(source.provenance, {
        origins: ["context-override"],
      }),
    };

    function recordRemap(): void {
      remaps.push({
        category: source.category,
        fromKey: source.canonicalKey,
        toKey: replacementKey,
        sourceLabel: source.label,
        replacementLabel: override.replacementLabel,
      });
      touchedKeys.add(source.canonicalKey);
      touchedKeys.add(replacementKey);
    }

    const collidesWith = fields.findIndex(
      (field) =>
        field.category === source.category &&
        field.canonicalKey === replacementKey,
    );

    if (collidesWith === -1) {
      fields[target.index] = derived;
      recordRemap();
      const validated: ExplicitSheetOverride = {
        op: "replace",
        sourceKey: source.canonicalKey,
        replacementLabel: override.replacementLabel,
      };
      overrides.push(validated);
      return { applied: validated };
    }

    const combined = combineDuplicate(fields[collidesWith]!, derived);
    if (
      combined.conflict !== null &&
      combined.conflict.code !== "INVALID_CONSTRAINT_VALUE"
    ) {
      return reject(combined.conflict);
    }
    fields[collidesWith] = combined.field;
    fields.splice(target.index, 1);
    recordRemap();
    const validated: ExplicitSheetOverride = {
      op: "replace",
      sourceKey: source.canonicalKey,
      replacementLabel: override.replacementLabel,
    };
    overrides.push(validated);
    return { applied: validated };
  }

  function applyConstrain(
    override: Extract<ProposedSheetOverride, { op: "constrain" }>,
  ): FieldOutcome {
    const target = resolveTarget(
      fields,
      remaps,
      override.targetLabel,
      override.category,
    );
    if (target.kind === "missing") {
      return reject(
        makeConflict(
          "MISSING_OVERRIDE_TARGET",
          null,
          [override.targetLabel],
          `No field matches the target label "${override.targetLabel}".`,
        ),
      );
    }
    if (target.kind === "ambiguous") {
      return reject(
        makeConflict(
          "AMBIGUOUS_OVERRIDE_TARGET",
          null,
          target.labels,
          `Target label "${override.targetLabel}" is ambiguous across multiple fields.`,
        ),
      );
    }

    const field = fields[target.index]!;
    if (field.category === "identity") {
      return reject(
        makeConflict(
          "INVALID_OVERRIDE_CONSTRAINTS",
          field.canonicalKey,
          [field.label],
          "Identity traits must not carry numeric bounds.",
        ),
      );
    }

    const existingRange = field.permittedValueRange;
    let nextRange: { min: number; max: number };
    if (override.min !== undefined && override.max !== undefined) {
      nextRange = { min: override.min, max: override.max };
    } else if (override.min !== undefined) {
      if (existingRange === undefined) {
        return reject(
          makeConflict(
            "INVALID_OVERRIDE_CONSTRAINTS",
            field.canonicalKey,
            [field.label],
            "A one-sided constraint requires an existing baseline range on the field.",
          ),
        );
      }
      nextRange = { min: override.min, max: existingRange.max };
    } else {
      if (existingRange === undefined) {
        return reject(
          makeConflict(
            "INVALID_OVERRIDE_CONSTRAINTS",
            field.canonicalKey,
            [field.label],
            "A one-sided constraint requires an existing baseline range on the field.",
          ),
        );
      }
      nextRange = { min: existingRange.min, max: override.max! };
    }

    if (nextRange.min > nextRange.max) {
      return reject(
        makeConflict(
          "INVALID_OVERRIDE_CONSTRAINTS",
          field.canonicalKey,
          [field.label],
          `The resulting constraint range ${nextRange.min}..${nextRange.max} is inverted.`,
        ),
      );
    }

    field.permittedValueRange = nextRange;
    field.provenance = mergeProvenance(field.provenance, {
      origins: ["context-override"],
    });
    touchedKeys.add(field.canonicalKey);
    const validated: ExplicitSheetOverride = {
      op: "constrain",
      targetKey: field.canonicalKey,
      ...(override.min !== undefined ? { min: override.min } : {}),
      ...(override.max !== undefined ? { max: override.max } : {}),
    };
    overrides.push(validated);
    return { applied: validated };
  }

  function applySetValue(
    override: Extract<ProposedSheetOverride, { op: "set_value" }>,
  ): FieldOutcome {
    const target = resolveTarget(
      fields,
      remaps,
      override.targetLabel,
      override.category,
    );
    if (target.kind === "missing") {
      return reject(
        makeConflict(
          "MISSING_OVERRIDE_TARGET",
          null,
          [override.targetLabel],
          `No field matches the target label "${override.targetLabel}".`,
        ),
      );
    }
    if (target.kind === "ambiguous") {
      return reject(
        makeConflict(
          "AMBIGUOUS_OVERRIDE_TARGET",
          null,
          target.labels,
          `Target label "${override.targetLabel}" is ambiguous across multiple fields.`,
        ),
      );
    }

    const field = fields[target.index]!;
    if (field.category === "identity" && typeof override.value === "number") {
      return reject(
        makeConflict(
          "INVALID_OVERRIDE_CONSTRAINTS",
          field.canonicalKey,
          [field.label],
          "Identity traits carry textual values only.",
        ),
      );
    }

    field.explicitValue = override.value ?? null;
    field.provenance = mergeProvenance(field.provenance, {
      origins: ["context-override"],
    });
    touchedKeys.add(field.canonicalKey);
    const validated: ExplicitSheetOverride = {
      op: "set_value",
      targetKey: field.canonicalKey,
      value: override.value,
    };
    overrides.push(validated);
    return { applied: validated };
  }

  function overrideTargetLabel(override: ProposedSheetOverride): string {
    switch (override.op) {
      case "add":
        return override.label;
      case "remove":
        return override.targetLabel;
      case "rename":
        return override.sourceLabel;
      case "replace":
        return override.sourceLabel;
      case "constrain":
        return override.targetLabel;
      case "set_value":
        return override.targetLabel;
    }
  }

  for (const instruction of proposed) {
    if (instruction.op === "field") {
      const outcome = applyFieldOverride(instruction.override);
      if (outcome.applied !== undefined) {
        applied.push({ op: "field", override: outcome.applied });
      }
      if (outcome.rejected !== undefined) {
        rejected.push({
          instruction,
          conflict: outcome.rejected.conflict,
        });
        newConflicts.push(outcome.rejected.conflict);
      }
      continue;
    }

    if (instruction.op === "set_character_name") {
      const normalizedName = CharacterNameSchema.parse(instruction.value);
      if (normalizedName === null) {
        const conflict = makeConflict(
          "INVALID_INSTRUCTION_CONTEXT",
          null,
          [],
          "A character name instruction must name a non-empty character.",
        );
        rejected.push({ instruction, conflict });
        newConflicts.push(conflict);
        continue;
      }
      characterName = normalizedName;
      applied.push({
        op: "set_character_name",
        characterName: normalizedName,
      });
      continue;
    }

    if (mode !== "npc") {
      const conflict = makeConflict(
        "INVALID_INSTRUCTION_CONTEXT",
        null,
        [],
        "An NPC portrait request is only valid for an NPC sheet.",
      );
      rejected.push({ instruction, conflict });
      newConflicts.push(conflict);
      continue;
    }
    npcPortraitIntent = instruction.intent;
    applied.push({
      op: "request_npc_portrait",
      intent: instruction.intent,
    });
  }

  const preservedConflicts = definition.conflicts.filter((conflict) => {
    if (conflict.code === "INVALID_CONSTRAINT_VALUE") {
      return false;
    }
    if (
      conflict.canonicalKey !== null &&
      touchedKeys.has(conflict.canonicalKey)
    ) {
      return false;
    }
    return true;
  });

  const recomputedConstraints: GenerationConflict[] = [];
  for (const field of fields) {
    const value = field.explicitValue;
    const range = field.permittedValueRange;
    if (
      field.category !== "mechanical" ||
      typeof value !== "number" ||
      range === undefined
    ) {
      continue;
    }
    if (value < range.min || value > range.max) {
      recomputedConstraints.push(
        makeConflict(
          "INVALID_CONSTRAINT_VALUE",
          field.canonicalKey,
          [field.label],
          `Explicit value ${value} falls outside the effective range ${range.min}..${range.max} of field "${field.label}".`,
        ),
      );
    }
  }

  const conflicts = [
    ...preservedConflicts,
    ...newConflicts,
    ...recomputedConstraints,
  ].slice(0, MAX_GENERATION_CONFLICTS);

  const nextDefinition: NormalizedSheetDefinition = {
    schemaVersion: definition.schemaVersion,
    mode,
    characterName,
    fields,
    sections: definition.sections,
    overrides,
    conflicts,
    ...(definition.npc !== undefined ? { npc: definition.npc } : {}),
  };

  return GenerationInstructionApplicationResultSchema.parse({
    definition: nextDefinition,
    appliedInstructions: applied,
    ...(rejected.length > 0 ? { rejectedInstructions: rejected } : {}),
    conflicts,
    keyRemaps: remaps,
    ...(npcPortraitIntent !== undefined ? { npcPortraitIntent } : {}),
  });
}
