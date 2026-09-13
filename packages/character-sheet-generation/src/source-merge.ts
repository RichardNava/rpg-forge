import { z } from "zod";
import { MAX_REFERENCED_RULES_PER_FIELD, MAX_TOTAL_FIELDS } from "./model.js";
import {
  GenerationConflictSchema,
  MAX_GENERATION_CONFLICTS,
  MAX_SOURCE_CITATIONS_PER_FIELD,
  SheetFieldSourceProvenanceSchema,
  SourceResolvedFieldSchema,
  type CanonicalFieldKey,
  type GenerationConflict,
  type GenerationConflictCode,
  type SheetFieldSourceProvenance,
  type SourceResolvedField,
} from "./source-resolution.js";

/**
 * Deterministic outcome of source resolution. Fields are the canonical merged
 * set and conflicts stay inspectable so normal equal-authority disagreements
 * fail visibly instead of vanishing silently.
 */
export const SourceResolutionResultSchema = z.strictObject({
  fields: z.array(SourceResolvedFieldSchema).max(MAX_TOTAL_FIELDS),
  conflicts: z.array(GenerationConflictSchema).max(MAX_GENERATION_CONFLICTS),
});
export type SourceResolutionResult = z.infer<
  typeof SourceResolutionResultSchema
>;

type DuplicateResolution = {
  field: SourceResolvedField;
  conflict: GenerationConflict | null;
};

/**
 * Merge identity is the pair (category, canonicalKey). Raw label similarity,
 * normalized rule keys, embeddings and AI judgment never participate.
 */
export function resolveSources(input: {
  gui: readonly SourceResolvedField[];
  rulebook: readonly SourceResolvedField[];
}): SourceResolutionResult {
  const fields: SourceResolvedField[] = [];
  const conflicts: GenerationConflict[] = [];
  const positionByIdentity = new Map<string, number>();

  function identityOf(field: SourceResolvedField): string {
    return `${field.category}:${field.canonicalKey}`;
  }

  /**
   * GUI fields pass through untouched unless they collide; rulebook-derived
   * fields then merge onto the GUI position or append after it, so exact
   * duplicates stay at the GUI authoring position and non-duplicate rulebook
   * fields keep their derived order.
   */
  function addField(field: SourceResolvedField): void {
    const identity = identityOf(field);
    const existingPosition = positionByIdentity.get(identity);
    if (existingPosition === undefined) {
      positionByIdentity.set(identity, fields.length);
      fields.push(field);
      return;
    }
    const resolution = combineDuplicate(fields[existingPosition]!, field);
    fields[existingPosition] = resolution.field;
    if (
      resolution.conflict !== null &&
      conflicts.length < MAX_GENERATION_CONFLICTS
    ) {
      conflicts.push(resolution.conflict);
    }
  }

  for (const field of input.gui) {
    addField(field);
  }
  for (const field of input.rulebook) {
    addField(field);
  }

  // Input-bound overflow throws here exactly like NormalizedSheetDefinitionSchema;
  // equal-authority disagreements above never throw and instead surface as conflicts.
  return SourceResolutionResultSchema.parse({ fields, conflicts });
}

/**
 * Deterministic duplicate resolution for one (category, canonicalKey). Equal
 * definitions merge additively (GUI label preserved, provenance evidence
 * merged exactly once). Definitions that cannot be represented together
 * produce a visible conflict and keep the first-arriving field, never a silent
 * winner. A merged numeric value outside the merged equal-authority range is
 * kept intact (no clipping, no invented precedence) and flagged visibly with
 * INVALID_CONSTRAINT_VALUE.
 *
 * Reused by the generation-instruction engine so an ADD or REPLACE that meets
 * an existing same-key field reconciles with exactly the source-resolution
 * rules instead of inventing a second, divergent merge behavior.
 */
export function combineDuplicate(
  existing: SourceResolvedField,
  incoming: SourceResolvedField,
): DuplicateResolution {
  const existingValue = existing.explicitValue ?? null;
  const incomingValue = incoming.explicitValue ?? null;
  const valuesDisagree =
    existingValue !== null &&
    incomingValue !== null &&
    existingValue !== incomingValue;

  const existingRange = existing.permittedValueRange;
  const incomingRange = incoming.permittedValueRange;
  const rangesDisagree =
    existingRange !== undefined &&
    incomingRange !== undefined &&
    !(
      existingRange.min === incomingRange.min &&
      existingRange.max === incomingRange.max
    );

  if (rangesDisagree) {
    return {
      field: existing,
      conflict: makeConflict(
        "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
        existing.canonicalKey,
        existing.label,
        incoming.label,
        "Equal-authority sources define different ranges for the same field.",
      ),
    };
  }

  if (valuesDisagree) {
    const code: GenerationConflictCode =
      existing.category === "mechanical"
        ? "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT"
        : "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE";
    return {
      field: existing,
      conflict: makeConflict(
        code,
        existing.canonicalKey,
        existing.label,
        incoming.label,
        existing.category === "mechanical"
          ? "Equal-authority sources disagree on the mechanical value of the same field."
          : "Equal-authority sources disagree on the identity value of the same field.",
      ),
    };
  }

  const label =
    existing.provenance.origins.includes("gui") ||
    incoming.provenance.origins.includes("gui")
      ? existing.provenance.origins.includes("gui")
        ? existing.label
        : incoming.label
      : existing.label;

  const resolvedValue = existingValue ?? incomingValue;
  const resolvedRange = existingRange ?? incomingRange;

  const field: SourceResolvedField = {
    canonicalKey: existing.canonicalKey,
    label,
    category: existing.category,
    ...(resolvedValue !== null ? { explicitValue: resolvedValue } : {}),
    ...(resolvedRange !== undefined
      ? { permittedValueRange: resolvedRange }
      : {}),
    ...(existing.kind !== undefined ? { kind: existing.kind } : {}),
    ...(existing.sectionKey !== undefined
      ? { sectionKey: existing.sectionKey }
      : {}),
    provenance: mergeProvenance(existing.provenance, incoming.provenance),
  };

  let conflict: GenerationConflict | null = null;
  if (
    existing.category === "mechanical" &&
    typeof resolvedValue === "number" &&
    resolvedRange !== undefined &&
    (resolvedValue < resolvedRange.min || resolvedValue > resolvedRange.max)
  ) {
    conflict = makeConflict(
      "INVALID_CONSTRAINT_VALUE",
      existing.canonicalKey,
      existing.label,
      incoming.label,
      `Explicit value ${resolvedValue} falls outside the merged equal-authority range ${resolvedRange.min}..${resolvedRange.max}.`,
    );
  }

  return { field, conflict };
}

function makeConflict(
  code: GenerationConflictCode,
  canonicalKey: CanonicalFieldKey,
  firstLabel: string,
  secondLabel: string,
  message: string,
): GenerationConflict {
  const sourceLabels = [firstLabel, secondLabel].filter(
    (label, index, all) => all.indexOf(label) === index,
  );
  return GenerationConflictSchema.parse({
    code,
    canonicalKey,
    message,
    sourceLabels,
  });
}

/**
 * Deterministically merges private provenance: origins deduplicated exactly
 * once in first-occurrence order, and rulebook evidence (ruleIds, citations)
 * deduplicated order-preserving. A GUI-only field never gains rule evidence;
 * a rulebook-only field keeps it. Citations are retained up to
 * MAX_SOURCE_CITATIONS_PER_FIELD (64) — the provenance schema's own per-field
 * contract ceiling, not a merge convenience — in first-occurrence order, so the
 * merged result always stays schema-valid and no smaller invented cap applies.
 */
export function mergeProvenance(
  first: SheetFieldSourceProvenance,
  second: SheetFieldSourceProvenance,
): SheetFieldSourceProvenance {
  const origins = dedupeStrings([...first.origins, ...second.origins]);
  const ruleIds = dedupeStrings([
    ...(first.ruleIds ?? []),
    ...(second.ruleIds ?? []),
  ]).slice(0, MAX_REFERENCED_RULES_PER_FIELD);

  const citations: SheetFieldSourceProvenance["citations"] = [];
  const seenCitations = new Set<string>();
  for (const citation of [
    ...(first.citations ?? []),
    ...(second.citations ?? []),
  ]) {
    const key = citationKey(citation);
    if (seenCitations.has(key)) {
      continue;
    }
    seenCitations.add(key);
    citations.push(citation);
  }
  const cappedCitations = citations.slice(0, MAX_SOURCE_CITATIONS_PER_FIELD);

  return SheetFieldSourceProvenanceSchema.parse({
    origins,
    ...(ruleIds.length > 0 ? { ruleIds } : {}),
    ...(cappedCitations.length > 0 ? { citations: cappedCitations } : {}),
  });
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function citationKey(citation: {
  sourceId: string;
  pageStart: number | null;
  pageEnd: number | null;
  section: string | null;
  chunkId: string | null;
}): string {
  return JSON.stringify([
    citation.sourceId,
    citation.pageStart,
    citation.pageEnd,
    citation.section,
    citation.chunkId,
  ]);
}
