import {
  NormalizedRuleIdSchema,
  RuleCitationSchema,
  type NormalizedRule,
  type RuleCitation,
  type RulesContext,
} from "@repo/rules-context";
import { z } from "zod";
import {
  AuthoredFieldLabelSchema,
  type CharacterSheetAuthoringMode,
} from "./authoring.js";
import { MAX_REFERENCED_RULES_PER_FIELD, MAX_TOTAL_FIELDS } from "./model.js";
import {
  canonicalizeFieldLabel,
  FieldCategorySchema,
  GenerationConflictSchema,
  MAX_GENERATION_CONFLICTS,
  MAX_OVERRIDE_STRING_VALUE_CHARS,
  MAX_SOURCE_CITATIONS_PER_FIELD,
  NumericValueRangeSchema,
  SourceResolvedFieldSchema,
  type FieldCategory,
  type GenerationConflict,
  type GenerationConflictCode,
  type SourceResolvedField,
} from "./source-resolution.js";

export const RULEBOOK_DERIVED_DEFINITION_VERSION = 1;

/**
 * Rulebook-side evidence a derivation proposal may carry. `ruleIds` reference
 * the authoritative normalized rules of the supplied RulesContext and are the
 * only required proof; citations are optional and, when present, must resolve
 * exactly to the genuine citations of the referenced rules.
 */
export const RulebookDerivedEvidenceSchema = z.strictObject({
  ruleIds: z
    .array(NormalizedRuleIdSchema)
    .min(1)
    .max(MAX_REFERENCED_RULES_PER_FIELD),
  citations: z
    .array(RuleCitationSchema)
    .max(MAX_SOURCE_CITATIONS_PER_FIELD)
    .optional(),
});
export type RulebookDerivedEvidence = z.infer<
  typeof RulebookDerivedEvidenceSchema
>;

/**
 * A provider-proposed sheet-level field. It deliberately carries no canonical
 * key, merge decision, source authority, replacement, id, source map or
 * ordering: those stay server-derived. `category` is optional and inferred
 * deterministically from the value/range payload when omitted.
 */
export const RulebookDerivedFieldSchema = z.strictObject({
  label: AuthoredFieldLabelSchema,
  category: FieldCategorySchema.optional(),
  explicitValue: z
    .union([
      z.number().finite(),
      z.string().max(MAX_OVERRIDE_STRING_VALUE_CHARS),
    ])
    .nullable()
    .optional(),
  permittedValueRange: NumericValueRangeSchema.optional(),
  evidence: RulebookDerivedEvidenceSchema,
});
export type RulebookDerivedField = z.infer<typeof RulebookDerivedFieldSchema>;

/** One bounded provider proposal: rulebook-derived fields only, no layout. */
export const RulebookDerivedDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(RULEBOOK_DERIVED_DEFINITION_VERSION),
  fields: z.array(RulebookDerivedFieldSchema).max(MAX_TOTAL_FIELDS),
});
export type RulebookDerivedDefinition = z.infer<
  typeof RulebookDerivedDefinitionSchema
>;

export type ParsedRulebookDerivedDefinition =
  | { ok: true; definition: RulebookDerivedDefinition }
  | { ok: false; error: string };

export function parseRulebookDerivedDefinition(
  raw: string,
): ParsedRulebookDerivedDefinition {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = RulebookDerivedDefinitionSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, definition: result.data };
}

/**
 * Deterministic outcome of validating a provider proposal against the
 * supplied RulesContext. `fields` are the accepted SourceResolvedFields in
 * derivation order (canonical keys server-derived); `conflicts` record every
 * field that was rejected for missing/dubious evidence or an impossible shape.
 */
export interface RulebookDerivationValidationResult {
  fields: SourceResolvedField[];
  conflicts: GenerationConflict[];
}

/**
 * The deterministic rulebook-derivation boundary. Every proposed field is
 * converted only when its evidence resolves against the RulesContext:
 *
 * - rule ids must name real normalized rules (fabricated evidence rejects the
 *   field and surfaces as a visible FABRICATED_RULE_EVIDENCE conflict);
 * - proposed citations must be genuine citations of the referenced rules
 *   (foreign evidence rejects the field with FOREIGN_CITATION_EVIDENCE; no
 *   silent repair);
 * - citations absent from the proposal are derived deterministically from the
 *   referenced rules, exactly like the compiled-field provenance builder;
 * - NPC mechanical fields may never carry an explicit numeric value;
 * - identity traits never carry numeric values or ranges.
 *
 * canonicalKey is always canonicalizeFieldLabel(label) on the server; the
 * provider never owns it.
 */
export function validateRulebookDerivedDefinition(input: {
  proposal: RulebookDerivedDefinition;
  context: RulesContext;
  mode: CharacterSheetAuthoringMode;
}): RulebookDerivationValidationResult {
  const ruleById = new Map(
    input.context.normalizedRules.map((rule) => [rule.id, rule]),
  );
  const fields: SourceResolvedField[] = [];
  const conflicts: GenerationConflict[] = [];

  for (const proposed of input.proposal.fields) {
    const resolved = resolveDerivedField(proposed, ruleById, input.mode);
    if ("conflict" in resolved) {
      if (conflicts.length < MAX_GENERATION_CONFLICTS) {
        conflicts.push(resolved.conflict);
      }
      continue;
    }
    fields.push(resolved.field);
  }

  return { fields, conflicts };
}

function resolveDerivedField(
  proposed: RulebookDerivedField,
  ruleById: ReadonlyMap<string, NormalizedRule>,
  mode: CharacterSheetAuthoringMode,
): { field: SourceResolvedField } | { conflict: GenerationConflict } {
  const key = canonicalizeFieldLabel(proposed.label);

  const category = resolveCategory(proposed);
  if (category === undefined) {
    return {
      conflict: makeRejection(
        "AMBIGUOUS_DERIVATION_CATEGORY",
        key,
        proposed.label,
        `Cannot determine whether "${proposed.label}" is a mechanical field or an identity trait.`,
      ),
    };
  }

  if (category === "identity") {
    if (typeof proposed.explicitValue === "number") {
      return {
        conflict: makeRejection(
          "INVALID_DERIVATION_FIELD",
          key,
          proposed.label,
          "Identity traits carry textual values only.",
        ),
      };
    }
    if (proposed.permittedValueRange !== undefined) {
      return {
        conflict: makeRejection(
          "INVALID_DERIVATION_FIELD",
          key,
          proposed.label,
          "Identity traits must not carry numeric bounds.",
        ),
      };
    }
  }

  if (
    category === "mechanical" &&
    mode === "npc" &&
    typeof proposed.explicitValue === "number"
  ) {
    return {
      conflict: makeRejection(
        "NPC_MECHANICAL_VALUE_FORBIDDEN",
        key,
        proposed.label,
        "NPC mechanical fields carry a permitted range and never an explicit numeric value.",
      ),
    };
  }

  const ruleIds: string[] = [];
  const seenRuleIds = new Set<string>();
  for (const ruleId of proposed.evidence.ruleIds) {
    if (!ruleById.has(ruleId)) {
      return {
        conflict: makeRejection(
          "FABRICATED_RULE_EVIDENCE",
          key,
          proposed.label,
          `Field "${proposed.label}" references rule "${ruleId}", which does not exist in the rules context.`,
        ),
      };
    }
    if (!seenRuleIds.has(ruleId)) {
      seenRuleIds.add(ruleId);
      ruleIds.push(ruleId);
    }
  }

  const genuineCitations = collectGenuineCitations(ruleIds, ruleById);

  let citations: RuleCitation[];
  if (proposed.evidence.citations === undefined) {
    citations = genuineCitations;
  } else {
    const genuineKeys = new Set(genuineCitations.map(citationKey));
    const deduped: RuleCitation[] = [];
    const seen = new Set<string>();
    for (const citation of proposed.evidence.citations) {
      const citationId = citationKey(citation);
      if (!genuineKeys.has(citationId)) {
        return {
          conflict: makeRejection(
            "FOREIGN_CITATION_EVIDENCE",
            key,
            proposed.label,
            `Field "${proposed.label}" carries citation evidence that none of its referenced rules provide.`,
          ),
        };
      }
      if (!seen.has(citationId)) {
        seen.add(citationId);
        deduped.push(citation);
      }
    }
    citations = deduped;
  }

  const resolvedCitations = citations.slice(0, MAX_SOURCE_CITATIONS_PER_FIELD);

  const field = SourceResolvedFieldSchema.parse({
    canonicalKey: key,
    label: proposed.label,
    category,
    ...(proposed.explicitValue !== undefined
      ? { explicitValue: proposed.explicitValue }
      : {}),
    ...(proposed.permittedValueRange !== undefined
      ? { permittedValueRange: proposed.permittedValueRange }
      : {}),
    provenance: {
      origins: ["rulebook"],
      ruleIds,
      ...(resolvedCitations.length > 0 ? { citations: resolvedCitations } : {}),
    },
  });

  return { field };
}

function resolveCategory(
  field: RulebookDerivedField,
): FieldCategory | undefined {
  if (field.category !== undefined) {
    return field.category;
  }
  if (
    typeof field.explicitValue === "number" ||
    field.permittedValueRange !== undefined
  ) {
    return "mechanical";
  }
  if (typeof field.explicitValue === "string") {
    return "identity";
  }
  return undefined;
}

function collectGenuineCitations(
  ruleIds: readonly string[],
  ruleById: ReadonlyMap<string, NormalizedRule>,
): RuleCitation[] {
  const citations: RuleCitation[] = [];
  const seen = new Set<string>();
  for (const ruleId of ruleIds) {
    const rule = ruleById.get(ruleId);
    if (rule === undefined) {
      continue;
    }
    for (const citation of rule.citations) {
      const citationId = citationKey(citation);
      if (seen.has(citationId)) {
        continue;
      }
      seen.add(citationId);
      citations.push(citation);
      if (citations.length >= MAX_SOURCE_CITATIONS_PER_FIELD) {
        return citations;
      }
    }
  }
  return citations;
}

function makeRejection(
  code: GenerationConflictCode,
  canonicalKey: string,
  sourceLabel: string,
  message: string,
): GenerationConflict {
  return GenerationConflictSchema.parse({
    code,
    canonicalKey,
    message,
    sourceLabels: [sourceLabel],
  });
}

function citationKey(citation: RuleCitation): string {
  return JSON.stringify([
    citation.sourceId,
    citation.pageStart,
    citation.pageEnd,
    citation.section,
    citation.chunkId,
  ]);
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
