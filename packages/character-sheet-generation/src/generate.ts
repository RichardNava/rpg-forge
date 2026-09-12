import type { RulesContext } from "@repo/rules-context";
import { z } from "zod";
import {
  CalculationCandidatesOutputSchema,
  FieldCandidatesOutputSchema,
  SectionPlanOutputSchema,
  type CalculationCandidate,
  type CalculationCandidatesOutput,
  type CalculationFieldIndexEntry,
  type FieldCandidate,
  type FieldCandidatesOutput,
  type SectionPlanOutput,
} from "./intermediate.js";
import { collectExpressionFieldKeys } from "./formulas.js";

export type ParsedPlan =
  { ok: true; plan: SectionPlanOutput } | { ok: false; error: string };

export type ParsedFields =
  { ok: true; fields: FieldCandidatesOutput } | { ok: false; error: string };

export type ParsedCalculations =
  | { ok: true; calculations: CalculationCandidatesOutput }
  | { ok: false; error: string };

export function parseSectionPlan(raw: string): ParsedPlan {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = SectionPlanOutputSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, plan: result.data };
}

export function parseFieldCandidates(raw: string): ParsedFields {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = FieldCandidatesOutputSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, fields: result.data };
}

export function parseCalculationCandidates(raw: string): ParsedCalculations {
  const value = parseJson(raw);
  if ("error" in value) {
    return { ok: false, error: value.error };
  }
  const result = CalculationCandidatesOutputSchema.safeParse(value.value);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }
  return { ok: true, calculations: result.data };
}

export function validateSectionPlanAgainstContext(
  plan: SectionPlanOutput,
  context: RulesContext,
): string | null {
  const problems: string[] = [];
  const knownRuleIds = new Set(context.normalizedRules.map((rule) => rule.id));

  const seen = new Set<string>();
  for (const section of plan.sections) {
    if (seen.has(section.key)) {
      problems.push(`section key "${section.key}" repeats`);
    }
    seen.add(section.key);

    for (const ruleId of section.ruleIds) {
      if (!knownRuleIds.has(ruleId)) {
        problems.push(
          `section "${section.key}" references unknown rule "${ruleId}"`,
        );
      }
    }
  }

  return problems.length === 0 ? null : problems.join("; ");
}

export function validateFieldCandidatesAgainstContext(
  fields: readonly FieldCandidate[],
  context: RulesContext,
  usedKeys: ReadonlySet<string>,
  usedFieldTypes: ReadonlyMap<string, FieldCandidate["type"]> = new Map(),
): string | null {
  const problems: string[] = [];
  const knownRuleIds = new Set(context.normalizedRules.map((rule) => rule.id));
  const localKeys = new Set<string>();
  const localFieldTypes = new Map<string, FieldCandidate["type"]>();

  for (const field of fields) {
    if (usedKeys.has(field.key)) {
      problems.push(
        `field key "${field.key}" is already used by another section`,
      );
    }
    if (localKeys.has(field.key)) {
      problems.push(`field key "${field.key}" repeats within the section`);
    }
    localKeys.add(field.key);
    localFieldTypes.set(field.key, field.type);

    for (const ruleId of field.ruleIds) {
      if (!knownRuleIds.has(ruleId)) {
        problems.push(
          `field "${field.key}" references unknown rule "${ruleId}"`,
        );
      }
    }
  }

  for (const field of fields) {
    if (field.type !== "resource") {
      continue;
    }
    for (const [target, refKey] of [
      ["currentFieldKey", field.references.currentFieldKey],
      ["maxFieldKey", field.references.maxFieldKey],
    ] as const) {
      if (refKey === undefined) {
        continue;
      }
      const resolvedType =
        localFieldTypes.get(refKey) ?? usedFieldTypes.get(refKey);
      if (resolvedType === undefined) {
        problems.push(
          `resource field "${field.key}" references unknown field "${refKey}"`,
        );
        continue;
      }
      if (resolvedType !== "number" && resolvedType !== "calculated") {
        problems.push(
          `resource field "${field.key}" ${target} references "${refKey}", ` +
            `which is a "${resolvedType}" field; a resource current/max field ` +
            "must be numeric or calculated",
        );
      }
    }
  }

  return problems.length === 0 ? null : problems.join("; ");
}

export function validateCalculationCandidatesAgainstContext(
  calculations: readonly CalculationCandidate[],
  fieldIndex: readonly CalculationFieldIndexEntry[],
): string | null {
  const problems: string[] = [];
  const entryByKey = new Map<string, CalculationFieldIndexEntry>();
  const calculatedKeys = new Set<string>();
  for (const entry of fieldIndex) {
    entryByKey.set(entry.key, entry);
    if (entry.type === "calculated") {
      calculatedKeys.add(entry.key);
    }
  }

  const seen = new Set<string>();
  for (const candidate of calculations) {
    if (!calculatedKeys.has(candidate.key)) {
      problems.push(
        `calculation key "${candidate.key}" does not match a calculated field`,
      );
    }
    if (seen.has(candidate.key)) {
      problems.push(`calculation key "${candidate.key}" repeats`);
    }
    seen.add(candidate.key);

    const referenced: string[] = [];
    collectExpressionFieldKeys(candidate.expression, referenced);
    const target = entryByKey.get(candidate.key);
    for (const refKey of referenced) {
      if (!entryByKey.has(refKey)) {
        problems.push(
          `calculation "${candidate.key}" references unknown field "${refKey}"`,
        );
        continue;
      }
      const reference = entryByKey.get(refKey)!;
      if (
        calculatedKeys.has(refKey) &&
        target !== undefined &&
        reference.sectionOrder > target.sectionOrder
      ) {
        problems.push(
          `calculation "${candidate.key}" (section "${target.sectionKey}", ` +
            `order ${target.sectionOrder}) references calculated field ` +
            `"${refKey}" (section "${reference.sectionKey}", order ` +
            `${reference.sectionOrder}), a forward reference; a calculation may ` +
            "only reference calculated fields in its own section or an earlier " +
            "section",
        );
      }
    }
    if (referenced.includes(candidate.key)) {
      problems.push(`calculation "${candidate.key}" references itself`);
    }
  }

  for (const key of calculatedKeys) {
    if (!seen.has(key)) {
      problems.push(`calculated field "${key}" has no calculation candidate`);
    }
  }

  return problems.length === 0 ? null : problems.join("; ");
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
