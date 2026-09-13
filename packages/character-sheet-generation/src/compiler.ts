import {
  CharacterSheetSpecSchema,
  type CharacterSheetField,
  type CharacterSheetSpec,
  type FieldPlacement,
  type Formula,
  type FormulaCondition,
  type SectionLayout,
} from "@repo/character-sheet-schema";
import type { RulesContext } from "@repo/rules-context";
import {
  collectExpressionFieldKeys,
  CompileCalculationError,
  compileCalculationExpression,
} from "./formulas.js";
import type {
  CalculationCandidate,
  FieldCandidate,
  SectionPlanOutput,
} from "./intermediate.js";
import {
  computeFieldPlacements,
  computeSectionColumns,
  compileTheme,
  intrinsicHeightHint,
  packSectionPages,
} from "./layout.js";
import { MAX_TOTAL_FIELDS } from "./model.js";
import { buildFieldProvenance } from "./provenance.js";

/** Canonical field shape without the layout placement, applied at spec build. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type MappedField = DistributiveOmit<
  CharacterSheetField,
  "placement" | "formula"
> & {
  formula?: Formula;
};

/**
 * Deterministic compilation from validated, bounded generation artifacts onto
 * the canonical CharacterSheetSpec. The compiler is pure and provider-free; it
 * never fabricates values and never invents citations or rule ids. Structural
 * problems caused by the model candidates surface as `candidate_invalid`;
 * internal invariants surface as `invariant`.
 */
export function compileCharacterSheet(input: {
  context: RulesContext | null;
  plan: SectionPlanOutput;
  fieldsBySection: ReadonlyMap<string, readonly FieldCandidate[]>;
  calculations: readonly CalculationCandidate[];
  /** Required for GUI-only metadata identity when `context` is null. */
  sheetId?: string;
}): CharacterSheetSpec {
  const { context, plan } = input;
  const fieldKeyToId = new Map<string, string>();
  const fieldSectionIndex = new Map<string, number>();
  const fieldSectionKey = new Map<string, string>();

  const sectionFieldCandidates = new Map<string, readonly FieldCandidate[]>();
  for (const [sectionIndex, section] of plan.sections.entries()) {
    const candidates = input.fieldsBySection.get(section.key);
    if (candidates === undefined || candidates.length === 0) {
      throw new SheetCompileError(
        "candidate_invalid",
        `Section "${section.key}" has no generated fields.`,
      );
    }
    sectionFieldCandidates.set(section.key, candidates);
    for (const candidate of candidates) {
      if (fieldKeyToId.has(candidate.key)) {
        throw new SheetCompileError(
          "candidate_invalid",
          `Field key "${candidate.key}" repeats across sections.`,
        );
      }
      fieldKeyToId.set(candidate.key, candidate.key);
      fieldSectionIndex.set(candidate.key, sectionIndex);
      fieldSectionKey.set(candidate.key, section.key);
    }
  }

  if (fieldKeyToId.size > MAX_TOTAL_FIELDS) {
    throw new SheetCompileError(
      "candidate_invalid",
      `A generated sheet may contain at most ${MAX_TOTAL_FIELDS} fields.`,
    );
  }

  if (context === null) {
    if (input.sheetId === undefined || input.sheetId.length === 0) {
      throw new SheetCompileError(
        "invariant",
        "GUI-only construction without a RulesContext requires an explicit sheetId.",
      );
    }
    for (const candidates of sectionFieldCandidates.values()) {
      for (const candidate of candidates) {
        if (candidate.ruleIds.length > 0) {
          throw new SheetCompileError(
            "candidate_invalid",
            `Field "${candidate.key}" carries rule ids but no RulesContext was ` +
              "supplied; GUI-only construction never produces rulebook provenance.",
          );
        }
      }
    }
  }

  const fields: MappedField[] = [];
  const sectionLayouts = new Map<string, SectionLayout>();
  const fieldPlacements = new Map<string, FieldPlacement>();

  for (const [sectionIndex, section] of plan.sections.entries()) {
    const candidates = sectionFieldCandidates.get(section.key) ?? [];
    const columns = computeSectionColumns(candidates.length);
    const placements = computeFieldPlacements(
      columns,
      candidates.map(fieldHeight),
      candidates.map((candidate) => candidate.breakBefore),
    );

    sectionLayouts.set(section.key, {
      mode: "grid",
      columns,
      order: sectionIndex,
      emphasis:
        sectionIndex === 0
          ? "primary"
          : sectionIndex === plan.sections.length - 1
            ? "secondary"
            : null,
    });

    candidates.forEach((candidate, candidateIndex) => {
      fieldPlacements.set(candidate.key, {
        ...placements[candidateIndex]!,
        order: candidateIndex,
      });
      fields.push(mapField(candidate));
    });
  }

  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const formulaById = new Map<string, Formula>();
  const calculatedFieldKeys = new Set<string>();
  for (const field of fields) {
    if (field.type === "calculated") {
      calculatedFieldKeys.add(field.id);
    }
  }

  for (const candidate of input.calculations) {
    if (!calculatedFieldKeys.has(candidate.key)) {
      throw new SheetCompileError(
        "candidate_invalid",
        `Calculation key "${candidate.key}" does not match a calculated field.`,
      );
    }
  }

  const resolvedByKey = new Set<string>();
  for (const candidate of input.calculations) {
    if (resolvedByKey.has(candidate.key)) {
      throw new SheetCompileError(
        "candidate_invalid",
        `Calculation key "${candidate.key}" repeats.`,
      );
    }
    resolvedByKey.add(candidate.key);

    const referenced: string[] = [];
    collectExpressionFieldKeys(candidate.expression, referenced);
    for (const refKey of referenced) {
      if (!fieldKeyToId.has(refKey)) {
        throw new SheetCompileError(
          "candidate_invalid",
          `Calculation "${candidate.key}" references unknown field "${refKey}".`,
        );
      }
      if (
        calculatedFieldKeys.has(refKey) &&
        (fieldSectionIndex.get(refKey) ?? 0) >
          (fieldSectionIndex.get(candidate.key) ?? 0)
      ) {
        const targetSection = fieldSectionKey.get(candidate.key) ?? "?";
        const targetOrder = fieldSectionIndex.get(candidate.key) ?? 0;
        const referenceSection = fieldSectionKey.get(refKey) ?? "?";
        const referenceOrder = fieldSectionIndex.get(refKey) ?? 0;
        throw new SheetCompileError(
          "candidate_invalid",
          `Calculation "${candidate.key}" (section "${targetSection}", ` +
            `order ${targetOrder}) references calculated field "${refKey}" ` +
            `(section "${referenceSection}", order ${referenceOrder}), a ` +
            "later-section forward reference.",
        );
      }
    }

    let formula: Formula;
    try {
      formula = compileCalculationExpression(
        candidate.expression,
        fieldKeyToId,
      );
    } catch (error) {
      if (error instanceof CompileCalculationError) {
        throw new SheetCompileError("candidate_invalid", error.details);
      }
      throw new SheetCompileError("invariant", detailFromUnknown(error));
    }

    const index = fields.findIndex((field) => field.id === candidate.key);
    const field = fields[index];
    if (field === undefined || field.type !== "calculated") {
      throw new SheetCompileError(
        "invariant",
        `Calculation key "${candidate.key}" did not resolve to a calculated field.`,
      );
    }
    fields[index] = {
      ...field,
      type: "calculated",
      formula,
      ...(candidate.displayFormat === undefined
        ? {}
        : { displayFormat: candidate.displayFormat }),
    };
    formulaById.set(candidate.key, formula);
    fieldById.set(candidate.key, fields[index]!);
  }

  assertNoFormulaCycles(fields);

  const sourceMap: CharacterSheetSpec["sourceMap"] = {};
  for (const section of plan.sections) {
    for (const candidate of sectionFieldCandidates.get(section.key) ?? []) {
      if (candidate.ruleIds.length === 0) {
        continue;
      }
      sourceMap[candidate.key] = buildFieldProvenance(
        candidate.ruleIds,
        context!,
      );
    }
  }

  const sections = plan.sections.map((section) => ({
    id: section.key,
    title: section.title,
    layout: sectionLayouts.get(section.key) ?? {
      mode: "grid",
      columns: 1,
      order: 0,
      emphasis: null,
    },
    fieldIds: (sectionFieldCandidates.get(section.key) ?? []).map(
      (candidate) => candidate.key,
    ),
  }));

  const pagePlans = packSectionPages(
    sections.map((section) => ({
      key: section.id,
      rowCost: 1 + Math.ceil(section.fieldIds.length / section.layout.columns),
    })),
    { pageRowCap: 30, maxPages: 12, maxSectionsPerPage: 16 },
  );
  const pages = pagePlans.map((page) => ({
    id: page.id,
    layout: {
      orientation: "portrait" as const,
      sizeIntent: null,
      sectionIds: [...page.sectionIds],
    },
  }));

  const spec: CharacterSheetSpec = {
    schemaVersion: "1",
    mode: plan.mode,
    metadata: {
      id: input.sheetId ?? context!.analysisId,
      title: plan.mode === "npc" ? "NPC Sheet" : "Character Sheet",
      description: null,
      locale: null,
    },
    rulesContextId: context === null ? null : context.analysisId,
    pages,
    sections,
    fields: fields.map((field) => {
      const placement = fieldPlacements.get(field.id) ?? {
        order: 0,
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      };
      return {
        ...field,
        type: field.type,
        ...(field.type === "calculated"
          ? { formula: formulaById.get(field.id)! }
          : {}),
        placement,
      } as CharacterSheetField;
    }),
    values: {},
    theme: compileTheme(plan.mode),
    sourceMap,
  };

  return CharacterSheetSpecSchema.parse(spec);
}

export class SheetCompileError extends Error {
  readonly reason: "candidate_invalid" | "invariant";
  readonly details: string;

  constructor(reason: "candidate_invalid" | "invariant", details: string) {
    super(details);
    this.name = "SheetCompileError";
    this.reason = reason;
    this.details = details;
  }
}

function mapField(candidate: FieldCandidate): MappedField {
  const common = {
    id: candidate.key,
    label: candidate.label,
    requiredForPlayableNpc: candidate.requiredForPlayableNpc,
  };

  switch (candidate.type) {
    case "text":
      return {
        ...common,
        type: "text",
        ...(candidate.maxLength === undefined
          ? {}
          : { maxLength: candidate.maxLength }),
      };
    case "number":
      return {
        ...common,
        type: "number",
        ...(candidate.min === undefined ? {} : { min: candidate.min }),
        ...(candidate.max === undefined ? {} : { max: candidate.max }),
        ...(candidate.step === undefined ? {} : { step: candidate.step }),
      };
    case "textarea":
      return {
        ...common,
        type: "textarea",
        ...(candidate.rows === undefined ? {} : { rows: candidate.rows }),
        ...(candidate.displayIntent === undefined
          ? {}
          : { displayIntent: candidate.displayIntent }),
      };
    case "checkbox":
      return { ...common, type: "checkbox" };
    case "radio":
      return {
        ...common,
        type: "radio",
        options: candidate.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      };
    case "select":
      return {
        ...common,
        type: "select",
        options: candidate.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      };
    case "multiselect":
      return {
        ...common,
        type: "multiselect",
        options: candidate.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      };
    case "rating":
      return { ...common, type: "rating", scale: { ...candidate.scale } };
    case "resource":
      return {
        ...common,
        type: "resource",
        currentFieldId: requireReference(candidate, "currentFieldKey"),
        maxFieldId: requireReference(candidate, "maxFieldKey"),
        displayMode: "current-max",
      };
    case "list":
      return {
        ...common,
        type: "list",
        itemLabel: candidate.itemLabel,
        ...(candidate.maxItems === undefined
          ? {}
          : { maxItems: candidate.maxItems }),
      };
    case "table":
      return {
        ...common,
        type: "table",
        columns: candidate.columns.map((column) => ({
          id: column.id,
          label: column.label,
          valueType: column.valueType,
        })),
        ...(candidate.maxRows === undefined
          ? {}
          : { maxRows: candidate.maxRows }),
      };
    case "calculated":
      return { ...common, type: "calculated" };
    case "image":
      return {
        ...common,
        type: "image",
        slot: {
          aspectRatio: candidate.slot.aspectRatio,
          maxColumnSpan: candidate.slot.maxColumnSpan,
          altText: candidate.slot.altText,
        },
      };
  }
}

function requireReference(
  candidate: FieldCandidate,
  which: "currentFieldKey" | "maxFieldKey",
): string {
  if (candidate.type !== "resource") {
    throw new SheetCompileError(
      "invariant",
      "Resource fields require dependency references.",
    );
  }
  return candidate.references[which];
}

function fieldHeight(candidate: FieldCandidate): number {
  switch (candidate.type) {
    case "textarea":
      return intrinsicHeightHint(
        "textarea",
        candidate.rows === undefined ? {} : { rows: candidate.rows },
      );
    case "list":
      return intrinsicHeightHint(
        "list",
        candidate.maxItems === undefined
          ? {}
          : { maxItems: candidate.maxItems },
      );
    case "table":
      return intrinsicHeightHint(
        "table",
        candidate.maxRows === undefined ? {} : { maxRows: candidate.maxRows },
      );
    case "image":
      return intrinsicHeightHint("image", {});
    default:
      return 1;
  }
}

function assertNoFormulaCycles(fields: readonly MappedField[]): void {
  const calculatedIds = new Set(
    fields
      .filter((field) => field.type === "calculated")
      .map((field) => field.id),
  );
  const references = new Map<string, string[]>();
  for (const field of fields) {
    if (field.type !== "calculated") {
      continue;
    }
    const collected: string[] = [];
    collectFormulaFieldIds(field.formula!, collected);
    references.set(field.id, collected);
  }

  const seen = new Set<string>();
  const parsing = new Set<string>();
  function visit(fieldId: string): void {
    if (parsing.has(fieldId)) {
      throw new SheetCompileError(
        "candidate_invalid",
        `Calculated fields participate in a formula cycle involving "${fieldId}".`,
      );
    }
    if (seen.has(fieldId)) {
      return;
    }
    parsing.add(fieldId);
    for (const referenced of references.get(fieldId) ?? []) {
      if (calculatedIds.has(referenced)) {
        visit(referenced);
      }
    }
    parsing.delete(fieldId);
    seen.add(fieldId);
  }
  for (const fieldId of references.keys()) {
    visit(fieldId);
  }
}

function collectFormulaFieldIds(formula: Formula, ids: string[]): void {
  switch (formula.op) {
    case "literal":
      return;
    case "field":
      ids.push(formula.fieldId);
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      collectFormulaFieldIds(formula.left, ids);
      collectFormulaFieldIds(formula.right, ids);
      return;
    case "min":
    case "max":
      for (const value of formula.values) {
        collectFormulaFieldIds(value, ids);
      }
      return;
    case "floor":
    case "ceil":
    case "round":
      collectFormulaFieldIds(formula.value, ids);
      return;
    case "conditional":
      collectFormulaConditionFieldIds(formula.condition, ids);
      collectFormulaFieldIds(formula.whenTrue, ids);
      collectFormulaFieldIds(formula.whenFalse, ids);
      return;
  }
}

function collectFormulaConditionFieldIds(
  condition: FormulaCondition,
  ids: string[],
): void {
  collectFormulaFieldIds(condition.left, ids);
  collectFormulaFieldIds(condition.right, ids);
}

function detailFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown compile failure.";
}
