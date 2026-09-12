import type { FieldProvenance } from "@repo/character-sheet-schema";
import type { RuleCitation, RulesContext } from "@repo/rules-context";
import { MAX_REFERENCED_RULES_PER_FIELD } from "./model.js";

/**
 * Builds canonical field provenance strictly from the RulesContext. `ruleIds`
 * are verified against the canonical context and deduplicated in caller order;
 * citations are the union of those rules' genuine citations, capped so the
 * canonical contract's bounded source map is always satisfied. Fabrication is
 * impossible by construction: the model never supplies citations here.
 */
export function buildFieldProvenance(
  ruleIds: readonly string[],
  context: RulesContext,
): FieldProvenance {
  const ruleById = new Map(
    context.normalizedRules.map((rule) => [rule.id, rule]),
  );

  const seenRuleIds = new Set<string>();
  const normalizedRuleIds: string[] = [];
  for (const ruleId of ruleIds.slice(0, MAX_REFERENCED_RULES_PER_FIELD)) {
    if (ruleById.has(ruleId) && !seenRuleIds.has(ruleId)) {
      seenRuleIds.add(ruleId);
      normalizedRuleIds.push(ruleId);
    }
  }

  if (normalizedRuleIds.length === 0) {
    // The canonical field contract requires at least one rule id per entry.
    // Callers only include source-map entries for genuinely rule-derived fields.
    throw new Error("Rule provenance requires at least one known rule id.");
  }

  const citations: RuleCitation[] = [];
  const seenCitations = new Set<string>();
  for (const ruleId of normalizedRuleIds) {
    const rule = ruleById.get(ruleId);
    if (rule === undefined) {
      continue;
    }
    for (const citation of rule.citations) {
      const key = citationKey(citation);
      if (seenCitations.has(key)) {
        continue;
      }
      seenCitations.add(key);
      citations.push(citation);
    }
  }

  return {
    ruleIds: normalizedRuleIds,
    ...(citations.length > 0 ? { citations: citations.slice(0, 64) } : {}),
  };
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

/** Shared rule-id resolver used by validation feedback. */
export function allRuleIds(context: RulesContext): Set<string> {
  return new Set(context.normalizedRules.map((rule) => rule.id));
}
