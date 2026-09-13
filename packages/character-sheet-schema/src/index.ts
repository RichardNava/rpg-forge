import {
  JsonValueSchema,
  NormalizedRuleIdSchema,
  RuleCitationSchema,
  RulesContextIdSchema,
  type JsonValue,
  type RuleCitation,
  type RuleSource,
  type RulesContext,
} from "@repo/rules-context";
import { z } from "zod";

export const CHARACTER_SHEET_SPEC_VERSION = "1" as const;

const MAX_PAGES = 12;
const MAX_SECTIONS = 48;
const MAX_FIELDS = 256;
const MAX_SECTIONS_PER_PAGE = 16;
const MAX_FIELDS_PER_SECTION = 64;
const MAX_LAYOUT_COLUMNS = 4;
const MAX_ROW_SPAN = 12;
const MAX_SOURCE_MAP_RULES = 64;
const MAX_SOURCE_MAP_CITATIONS = 64;
const MAX_DIAGNOSTIC_PATH_SEGMENTS = 32;
const MAX_FORMULA_DEPTH = 8;
const MAX_FIELD_VALUE_ENTRIES = MAX_FIELDS;
const MAX_SOURCE_MAP_ENTRIES = MAX_FIELDS;
const MAX_DOMAIN_ISSUES = 256;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const colorPattern = /^#[0-9A-Fa-f]{6}$/;

/**
 * Sheet identifiers are server-minted opaque strings, never model-emitted, so
 * the reserved-name guard is a runtime refinement rather than a regex. This
 * keeps rejection semantics identical while leaving the emitted JSON Schema free
 * of negative lookaheads, which Cloudflare AI's grammar engine does not support.
 */
const reservedIdentifierPattern = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(identifierPattern, "Identifiers must use a safe opaque format.")
  .refine(
    (value) => !reservedIdentifierPattern.has(value),
    "Reserved identifiers are not allowed.",
  );
const shortTextSchema = z.string().min(1).max(256).regex(/\S/);
const longTextSchema = z.string().min(1).max(2_000).regex(/\S/);

export const CharacterSheetIdSchema = identifierSchema;
export type CharacterSheetId = z.infer<typeof CharacterSheetIdSchema>;

export const PageIdSchema = identifierSchema;
export type PageId = z.infer<typeof PageIdSchema>;

export const SectionIdSchema = identifierSchema;
export type SectionId = z.infer<typeof SectionIdSchema>;

export const FieldIdSchema = identifierSchema;
export type FieldId = z.infer<typeof FieldIdSchema>;

export const CharacterSheetModeSchema = z.enum(["player", "npc"]);
export type CharacterSheetMode = z.infer<typeof CharacterSheetModeSchema>;

export const CharacterSheetMetadataSchema = z.strictObject({
  id: CharacterSheetIdSchema,
  title: shortTextSchema,
  description: longTextSchema.nullable(),
  locale: z
    .string()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
    .nullable(),
});
export type CharacterSheetMetadata = z.infer<
  typeof CharacterSheetMetadataSchema
>;

export const PageLayoutSchema = z.strictObject({
  orientation: z.enum(["portrait", "landscape"]),
  sizeIntent: z.enum(["letter", "a4", "compact"]).nullable(),
  sectionIds: z.array(SectionIdSchema).min(1).max(MAX_SECTIONS_PER_PAGE),
});
export type PageLayout = z.infer<typeof PageLayoutSchema>;

export const CharacterSheetPageSchema = z.strictObject({
  id: PageIdSchema,
  layout: PageLayoutSchema,
});
export type CharacterSheetPage = z.infer<typeof CharacterSheetPageSchema>;

export const SectionLayoutSchema = z.strictObject({
  mode: z.enum(["flow", "grid"]),
  columns: z.number().int().min(1).max(MAX_LAYOUT_COLUMNS),
  order: z.number().int().min(0).max(999),
  emphasis: z.enum(["normal", "primary", "secondary"]).nullable(),
});
export type SectionLayout = z.infer<typeof SectionLayoutSchema>;

export const CharacterSheetSectionSchema = z.strictObject({
  id: SectionIdSchema,
  title: shortTextSchema,
  layout: SectionLayoutSchema,
  fieldIds: z.array(FieldIdSchema).min(1).max(MAX_FIELDS_PER_SECTION),
});
export type CharacterSheetSection = z.infer<typeof CharacterSheetSectionSchema>;

export const FieldPlacementSchema = z.strictObject({
  order: z.number().int().min(0).max(9_999),
  columnStart: z.number().int().min(1).max(MAX_LAYOUT_COLUMNS),
  columnSpan: z.number().int().min(1).max(MAX_LAYOUT_COLUMNS),
  rowSpan: z.number().int().min(1).max(MAX_ROW_SPAN),
  breakBefore: z.boolean(),
});
export type FieldPlacement = z.infer<typeof FieldPlacementSchema>;

const fieldBaseShape = {
  id: FieldIdSchema,
  label: shortTextSchema,
  requiredForPlayableNpc: z.boolean(),
  placement: FieldPlacementSchema,
} as const;

export const FieldOptionSchema = z.strictObject({
  value: identifierSchema,
  label: shortTextSchema,
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const TableColumnSchema = z.strictObject({
  id: identifierSchema,
  label: shortTextSchema,
  valueType: z.enum(["text", "number", "checkbox"]),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

// Private recursive typing aids for schema construction; public types are inferred below.
type FormulaAst =
  | { op: "literal"; value: number }
  | { op: "field"; fieldId: string }
  | { op: "add"; left: FormulaAst; right: FormulaAst }
  | { op: "subtract"; left: FormulaAst; right: FormulaAst }
  | { op: "multiply"; left: FormulaAst; right: FormulaAst }
  | { op: "divide"; left: FormulaAst; right: FormulaAst }
  | { op: "min"; values: FormulaAst[] }
  | { op: "max"; values: FormulaAst[] }
  | { op: "floor"; value: FormulaAst }
  | { op: "ceil"; value: FormulaAst }
  | { op: "round"; value: FormulaAst }
  | {
      op: "conditional";
      condition: FormulaConditionAst;
      whenTrue: FormulaAst;
      whenFalse: FormulaAst;
    };

type FormulaConditionAst = {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  left: FormulaAst;
  right: FormulaAst;
};

function createFormulaConditionSchema(
  formulaSchema: z.ZodType<FormulaAst>,
): z.ZodType<FormulaConditionAst> {
  return z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("eq"),
      left: formulaSchema,
      right: formulaSchema,
    }),
    z.strictObject({
      op: z.literal("neq"),
      left: formulaSchema,
      right: formulaSchema,
    }),
    z.strictObject({
      op: z.literal("gt"),
      left: formulaSchema,
      right: formulaSchema,
    }),
    z.strictObject({
      op: z.literal("gte"),
      left: formulaSchema,
      right: formulaSchema,
    }),
    z.strictObject({
      op: z.literal("lt"),
      left: formulaSchema,
      right: formulaSchema,
    }),
    z.strictObject({
      op: z.literal("lte"),
      left: formulaSchema,
      right: formulaSchema,
    }),
  ]);
}

function createFormulaSchema(remainingDepth: number): z.ZodType<FormulaAst> {
  const terminalSchemas = [
    z.strictObject({
      op: z.literal("literal"),
      value: z.number().finite(),
    }),
    z.strictObject({
      op: z.literal("field"),
      fieldId: FieldIdSchema,
    }),
  ] as const;

  if (remainingDepth === 0) {
    return z.discriminatedUnion("op", terminalSchemas);
  }

  const nestedFormulaSchema = createFormulaSchema(remainingDepth - 1);
  const nestedFormulaConditionSchema =
    createFormulaConditionSchema(nestedFormulaSchema);

  return z.discriminatedUnion("op", [
    ...terminalSchemas,
    z.strictObject({
      op: z.literal("add"),
      left: nestedFormulaSchema,
      right: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("subtract"),
      left: nestedFormulaSchema,
      right: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("multiply"),
      left: nestedFormulaSchema,
      right: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("divide"),
      left: nestedFormulaSchema,
      right: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("min"),
      values: z.array(nestedFormulaSchema).min(1).max(32),
    }),
    z.strictObject({
      op: z.literal("max"),
      values: z.array(nestedFormulaSchema).min(1).max(32),
    }),
    z.strictObject({
      op: z.literal("floor"),
      value: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("ceil"),
      value: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("round"),
      value: nestedFormulaSchema,
    }),
    z.strictObject({
      op: z.literal("conditional"),
      condition: nestedFormulaConditionSchema,
      whenTrue: nestedFormulaSchema,
      whenFalse: nestedFormulaSchema,
    }),
  ]);
}

/** Formula depth is finite so malformed input cannot exhaust the validator stack. */
export const FormulaSchema = createFormulaSchema(MAX_FORMULA_DEPTH);
export const FormulaConditionSchema =
  createFormulaConditionSchema(FormulaSchema);
export type Formula = z.infer<typeof FormulaSchema>;
export type FormulaCondition = z.infer<typeof FormulaConditionSchema>;

export const TextFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("text"),
  maxLength: z.number().int().min(1).max(10_000).optional(),
});
export type TextField = z.infer<typeof TextFieldSchema>;

export const NumberFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("number"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
});
export type NumberField = z.infer<typeof NumberFieldSchema>;

export const TextareaFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("textarea"),
  rows: z.number().int().min(1).max(20).optional(),
  displayIntent: z.enum(["notes", "description", "narrative"]).optional(),
});
export type TextareaField = z.infer<typeof TextareaFieldSchema>;

export const CheckboxFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("checkbox"),
});
export type CheckboxField = z.infer<typeof CheckboxFieldSchema>;

export const RadioFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("radio"),
  options: z.array(FieldOptionSchema).min(1).max(64),
});
export type RadioField = z.infer<typeof RadioFieldSchema>;

export const SelectFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("select"),
  options: z.array(FieldOptionSchema).min(1).max(64),
});
export type SelectField = z.infer<typeof SelectFieldSchema>;

export const MultiselectFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("multiselect"),
  options: z.array(FieldOptionSchema).min(1).max(64),
});
export type MultiselectField = z.infer<typeof MultiselectFieldSchema>;

export const RatingFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("rating"),
  scale: z.strictObject({
    min: z.number().int().min(0).max(100),
    max: z.number().int().min(0).max(100),
    step: z.number().int().positive().max(100),
  }),
});
export type RatingField = z.infer<typeof RatingFieldSchema>;

export const ResourceFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("resource"),
  currentFieldId: FieldIdSchema,
  maxFieldId: FieldIdSchema,
  displayMode: z.enum(["current-max", "bar"]),
});
export type ResourceField = z.infer<typeof ResourceFieldSchema>;

export const ListFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("list"),
  itemLabel: shortTextSchema,
  maxItems: z.number().int().min(1).max(100).optional(),
});
export type ListField = z.infer<typeof ListFieldSchema>;

export const TableFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("table"),
  columns: z.array(TableColumnSchema).min(1).max(16),
  maxRows: z.number().int().min(1).max(100).optional(),
});
export type TableField = z.infer<typeof TableFieldSchema>;

export const CalculatedFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("calculated"),
  formula: FormulaSchema,
  displayFormat: z.enum(["number", "integer", "percent"]).optional(),
});
export type CalculatedField = z.infer<typeof CalculatedFieldSchema>;

export const ImageFieldSchema = z.strictObject({
  ...fieldBaseShape,
  type: z.literal("image"),
  slot: z.strictObject({
    aspectRatio: z.enum(["square", "portrait", "landscape", "free"]),
    maxColumnSpan: z.number().int().min(1).max(MAX_LAYOUT_COLUMNS),
    altText: shortTextSchema.nullable(),
  }),
});
export type ImageField = z.infer<typeof ImageFieldSchema>;

/** Field variants have bounded, type-specific data and never accept arbitrary HTML, CSS, SVG, or image bytes. */
export const CharacterSheetFieldSchema = z.discriminatedUnion("type", [
  TextFieldSchema,
  NumberFieldSchema,
  TextareaFieldSchema,
  CheckboxFieldSchema,
  RadioFieldSchema,
  SelectFieldSchema,
  MultiselectFieldSchema,
  RatingFieldSchema,
  ResourceFieldSchema,
  ListFieldSchema,
  TableFieldSchema,
  CalculatedFieldSchema,
  ImageFieldSchema,
]);
export type CharacterSheetField = z.infer<typeof CharacterSheetFieldSchema>;

export const ThemeSpecSchema = z.strictObject({
  style: z.enum(["minimal", "classic", "ornate", "modern", "utility"]),
  typography: z.enum(["serif", "sans-serif", "monospace", "handwritten"]),
  density: z.enum(["compact", "standard", "spacious"]),
  borderStyle: z.enum(["none", "line", "double-line", "ornamental"]),
  decorationIntensity: z.enum(["none", "subtle", "moderate", "high"]),
  accentColor: z.string().regex(colorPattern, "accentColor must use #RRGGBB."),
  backgroundIntent: z.enum(["none", "light", "dark", "parchment", "textured"]),
});
export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

export const FieldProvenanceSchema = z.strictObject({
  ruleIds: z.array(NormalizedRuleIdSchema).min(1).max(MAX_SOURCE_MAP_RULES),
  citations: z
    .array(RuleCitationSchema)
    .max(MAX_SOURCE_MAP_CITATIONS)
    .optional(),
});
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

/**
 * Canonical serializable character-sheet contract. It holds renderer-neutral
 * structure and values, not PDF bytes, CSS, HTML, or executable formulas.
 */
export const CharacterSheetSpecSchema = z.strictObject({
  schemaVersion: z.literal(CHARACTER_SHEET_SPEC_VERSION),
  mode: CharacterSheetModeSchema,
  metadata: CharacterSheetMetadataSchema,
  rulesContextId: RulesContextIdSchema.nullable(),
  pages: z.array(CharacterSheetPageSchema).min(1).max(MAX_PAGES),
  sections: z.array(CharacterSheetSectionSchema).min(1).max(MAX_SECTIONS),
  fields: z.array(CharacterSheetFieldSchema).min(1).max(MAX_FIELDS),
  values: z
    .record(FieldIdSchema, JsonValueSchema)
    .superRefine((value, context) => {
      if (Object.keys(value).length > MAX_FIELD_VALUE_ENTRIES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A sheet may contain at most ${MAX_FIELD_VALUE_ENTRIES} field values.`,
        });
      }
    }),
  theme: ThemeSpecSchema,
  sourceMap: z
    .record(FieldIdSchema, FieldProvenanceSchema)
    .superRefine((value, context) => {
      if (Object.keys(value).length > MAX_SOURCE_MAP_ENTRIES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A sheet may contain at most ${MAX_SOURCE_MAP_ENTRIES} provenance entries.`,
        });
      }
    }),
});
export type CharacterSheetSpec = z.infer<typeof CharacterSheetSpecSchema>;

export const CharacterSheetDomainIssueCodeSchema = z.enum([
  "DUPLICATE_PAGE_ID",
  "DUPLICATE_SECTION_ID",
  "DUPLICATE_FIELD_ID",
  "UNKNOWN_SECTION_REFERENCE",
  "DUPLICATE_PAGE_SECTION_REFERENCE",
  "ORPHAN_SECTION",
  "DUPLICATE_SECTION_REFERENCE",
  "DUPLICATE_SECTION_ORDER",
  "UNKNOWN_FIELD_REFERENCE",
  "DUPLICATE_SECTION_FIELD_REFERENCE",
  "ORPHAN_FIELD",
  "DUPLICATE_FIELD_REFERENCE",
  "FIELD_PLACEMENT_OUT_OF_BOUNDS",
  "TOO_MANY_FIELD_VALUES",
  "UNKNOWN_VALUE_FIELD",
  "INVALID_FIELD_VALUE",
  "MISSING_PLAYABLE_NPC_VALUE",
  "INVALID_NUMBER_FIELD_RANGE",
  "INVALID_RATING_SCALE",
  "DUPLICATE_FIELD_OPTION_VALUE",
  "DUPLICATE_TABLE_COLUMN_ID",
  "UNKNOWN_RESOURCE_FIELD",
  "INVALID_RESOURCE_FIELD_TYPE",
  "RESOURCE_FIELDS_MUST_DIFFER",
  "UNKNOWN_FORMULA_FIELD",
  "FORMULA_CYCLE",
  "FORMULA_FORWARD_REFERENCE",
  "TOO_MANY_SOURCE_MAP_ENTRIES",
  "UNKNOWN_SOURCE_MAP_FIELD",
  "UNKNOWN_SOURCE_MAP_RULE",
  "UNKNOWN_SOURCE_MAP_CITATION_SOURCE",
  "SOURCE_MAP_CITATION_PAGE_OUT_OF_RANGE",
  "SOURCE_MAP_CITATION_NOT_LINKED_TO_RULE",
  "PROVENANCE_CONTEXT_REQUIRED",
  "SOURCE_MAP_WITH_NULL_RULES_CONTEXT",
  "RULES_CONTEXT_ID_MISMATCH",
]);
export type CharacterSheetDomainIssueCode = z.infer<
  typeof CharacterSheetDomainIssueCodeSchema
>;

export const CharacterSheetDomainIssueSchema = z.strictObject({
  code: CharacterSheetDomainIssueCodeSchema,
  path: z
    .array(z.union([z.string(), z.number().int().nonnegative()]))
    .max(MAX_DIAGNOSTIC_PATH_SEGMENTS),
  message: z.string().min(1).max(500),
});
export type CharacterSheetDomainIssue = z.infer<
  typeof CharacterSheetDomainIssueSchema
>;

export const CharacterSheetDomainValidationResultSchema = z.discriminatedUnion(
  "valid",
  [
    z.strictObject({ valid: z.literal(true), issues: z.tuple([]) }),
    z.strictObject({
      valid: z.literal(false),
      issues: z.array(CharacterSheetDomainIssueSchema).min(1),
    }),
  ],
);
export type CharacterSheetDomainValidationResult = z.infer<
  typeof CharacterSheetDomainValidationResultSchema
>;

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return [...duplicates];
}

function addIssue(
  issues: CharacterSheetDomainIssue[],
  code: CharacterSheetDomainIssueCode,
  path: CharacterSheetDomainIssue["path"],
  message: string,
): void {
  if (issues.length < MAX_DOMAIN_ISSUES) {
    issues.push({ code, path, message });
  }
}

function collectFormulaFieldIds(formula: Formula, fieldIds: string[]): void {
  switch (formula.op) {
    case "literal":
      return;
    case "field":
      fieldIds.push(formula.fieldId);
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      collectFormulaFieldIds(formula.left, fieldIds);
      collectFormulaFieldIds(formula.right, fieldIds);
      return;
    case "min":
    case "max":
      for (const value of formula.values) {
        collectFormulaFieldIds(value, fieldIds);
      }
      return;
    case "floor":
    case "ceil":
    case "round":
      collectFormulaFieldIds(formula.value, fieldIds);
      return;
    case "conditional":
      collectFormulaConditionFieldIds(formula.condition, fieldIds);
      collectFormulaFieldIds(formula.whenTrue, fieldIds);
      collectFormulaFieldIds(formula.whenFalse, fieldIds);
      return;
  }
}

function collectFormulaConditionFieldIds(
  condition: FormulaCondition,
  fieldIds: string[],
): void {
  collectFormulaFieldIds(condition.left, fieldIds);
  collectFormulaFieldIds(condition.right, fieldIds);
}

function isNumericOrCalculatedField(field: CharacterSheetField): boolean {
  return field.type === "number" || field.type === "calculated";
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStepAligned(value: number, minimum: number, step: number): boolean {
  const quotient = (value - minimum) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function validateFieldValue(
  field: CharacterSheetField,
  value: JsonValue,
): string | null {
  switch (field.type) {
    case "text":
      if (typeof value !== "string") {
        return "A text field value must be a string.";
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `A text field value may contain at most ${field.maxLength} characters.`;
      }
      return null;
    case "textarea":
      return typeof value === "string"
        ? null
        : "A textarea field value must be a string.";
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "A number field value must be a finite number.";
      }
      if (field.min !== undefined && value < field.min) {
        return `A number field value must be at least ${field.min}.`;
      }
      if (field.max !== undefined && value > field.max) {
        return `A number field value must be at most ${field.max}.`;
      }
      if (
        field.step !== undefined &&
        !isStepAligned(value, field.min ?? 0, field.step)
      ) {
        return `A number field value must align to step ${field.step}.`;
      }
      return null;
    case "checkbox":
      return typeof value === "boolean"
        ? null
        : "A checkbox field value must be a boolean.";
    case "radio":
    case "select":
      if (typeof value !== "string") {
        return `A ${field.type} field value must be a string option.`;
      }
      return field.options.some((option) => option.value === value)
        ? null
        : `A ${field.type} field value must match a declared option.`;
    case "multiselect":
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
      ) {
        return "A multiselect field value must be an array of string options.";
      }
      if (new Set(value).size !== value.length) {
        return "A multiselect field value must not repeat an option.";
      }
      return value.every((entry) =>
        field.options.some((option) => option.value === entry),
      )
        ? null
        : "A multiselect field value must match declared options.";
    case "rating":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return "A rating field value must be an integer.";
      }
      if (value < field.scale.min || value > field.scale.max) {
        return `A rating field value must be between ${field.scale.min} and ${field.scale.max}.`;
      }
      return isStepAligned(value, field.scale.min, field.scale.step)
        ? null
        : `A rating field value must align to step ${field.scale.step}.`;
    case "resource":
    case "calculated":
      return `A ${field.type} field derives its value and does not accept a direct value.`;
    case "list":
      if (!Array.isArray(value)) {
        return "A list field value must be an array.";
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return `A list field value may contain at most ${field.maxItems} items.`;
      }
      return null;
    case "table": {
      if (!Array.isArray(value)) {
        return "A table field value must be an array of rows.";
      }
      if (field.maxRows !== undefined && value.length > field.maxRows) {
        return `A table field value may contain at most ${field.maxRows} rows.`;
      }

      const columnById = new Map(
        field.columns.map((column) => [column.id, column]),
      );
      for (const row of value) {
        if (!isJsonRecord(row)) {
          return "A table field row must be an object.";
        }
        for (const [columnId, cellValue] of Object.entries(row)) {
          const column = columnById.get(columnId);
          if (column === undefined) {
            return `A table field row references unknown column "${columnId}".`;
          }
          if (cellValue === null) {
            continue;
          }
          if (
            (column.valueType === "text" && typeof cellValue !== "string") ||
            (column.valueType === "number" && typeof cellValue !== "number") ||
            (column.valueType === "checkbox" && typeof cellValue !== "boolean")
          ) {
            return `A table field cell for column "${columnId}" has an invalid value type.`;
          }
        }
      }
      return null;
    }
    case "image":
      return typeof value === "string" && identifierPattern.test(value)
        ? null
        : "An image field value must be an opaque asset reference.";
  }
}

function getCitationKey(citation: RuleCitation): string {
  return JSON.stringify([
    citation.sourceId,
    citation.pageStart,
    citation.pageEnd,
    citation.section,
    citation.chunkId,
  ]);
}

type RulesContextProvenanceIndex = {
  readonly ruleBitsById: ReadonlyMap<string, bigint>;
  readonly sourceById: ReadonlyMap<string, RuleSource>;
  readonly ruleBitsByCitationKey: ReadonlyMap<string, bigint>;
};

// Build once per validation call so each provenance citation has indexed membership checks.
function createRulesContextProvenanceIndex(
  rulesContext: Pick<RulesContext, "normalizedRules" | "sources">,
): RulesContextProvenanceIndex {
  const ruleBitsById = new Map<string, bigint>();
  const sourceById = new Map(
    rulesContext.sources.map((source) => [source.id, source]),
  );

  for (const rule of rulesContext.normalizedRules) {
    if (!ruleBitsById.has(rule.id)) {
      ruleBitsById.set(rule.id, 1n << BigInt(ruleBitsById.size));
    }
  }

  const ruleBitsByCitationKey = new Map<string, bigint>();
  for (const rule of rulesContext.normalizedRules) {
    const ruleBit = ruleBitsById.get(rule.id);
    if (ruleBit === undefined) {
      continue;
    }

    for (const citation of rule.citations) {
      const citationKey = getCitationKey(citation);
      ruleBitsByCitationKey.set(
        citationKey,
        (ruleBitsByCitationKey.get(citationKey) ?? 0n) | ruleBit,
      );
    }
  }

  return { ruleBitsById, sourceById, ruleBitsByCitationKey };
}

/**
 * Validates graph integrity, layout bounds, explicit NPC value requirements,
 * and formula references. Pass a parsed RulesContext to validate rule
 * provenance IDs as well.
 */
export function validateCharacterSheetSpecDomain(
  spec: CharacterSheetSpec,
  rulesContext?: Pick<
    RulesContext,
    "analysisId" | "normalizedRules" | "sources"
  > | null,
): CharacterSheetDomainValidationResult {
  const issues: CharacterSheetDomainIssue[] = [];
  const pageIds = spec.pages.map((page) => page.id);
  const sectionIds = spec.sections.map((section) => section.id);
  const fieldIds = spec.fields.map((field) => field.id);
  const sectionIdSet = new Set(sectionIds);
  const fieldIdSet = new Set(fieldIds);
  const sectionById = new Map(
    spec.sections.map((section) => [section.id, section]),
  );
  const fieldById = new Map(spec.fields.map((field) => [field.id, field]));

  for (const pageId of findDuplicates(pageIds)) {
    addIssue(
      issues,
      "DUPLICATE_PAGE_ID",
      ["pages"],
      `Page id "${pageId}" appears more than once.`,
    );
  }

  for (const sectionId of findDuplicates(sectionIds)) {
    addIssue(
      issues,
      "DUPLICATE_SECTION_ID",
      ["sections"],
      `Section id "${sectionId}" appears more than once.`,
    );
  }

  for (const fieldId of findDuplicates(fieldIds)) {
    addIssue(
      issues,
      "DUPLICATE_FIELD_ID",
      ["fields"],
      `Field id "${fieldId}" appears more than once.`,
    );
  }

  const sectionReferenceCount = new Map<string, number>();
  for (const [pageIndex, page] of spec.pages.entries()) {
    for (const sectionId of findDuplicates(page.layout.sectionIds)) {
      addIssue(
        issues,
        "DUPLICATE_PAGE_SECTION_REFERENCE",
        ["pages", pageIndex, "layout", "sectionIds"],
        `Page "${page.id}" repeats section "${sectionId}".`,
      );
    }

    const pageSectionOrders = new Set<number>();
    for (const sectionId of page.layout.sectionIds) {
      const section = sectionById.get(sectionId);
      if (section === undefined) {
        addIssue(
          issues,
          "UNKNOWN_SECTION_REFERENCE",
          ["pages", pageIndex, "layout", "sectionIds"],
          `Page "${page.id}" references unknown section "${sectionId}".`,
        );
        continue;
      }

      sectionReferenceCount.set(
        sectionId,
        (sectionReferenceCount.get(sectionId) ?? 0) + 1,
      );

      if (pageSectionOrders.has(section.layout.order)) {
        addIssue(
          issues,
          "DUPLICATE_SECTION_ORDER",
          ["pages", pageIndex, "layout", "sectionIds"],
          `Page "${page.id}" contains duplicate section order ${section.layout.order}.`,
        );
      }
      pageSectionOrders.add(section.layout.order);
    }
  }

  for (const sectionId of sectionIdSet) {
    const referenceCount = sectionReferenceCount.get(sectionId) ?? 0;
    if (referenceCount === 0) {
      addIssue(
        issues,
        "ORPHAN_SECTION",
        ["sections"],
        `Section "${sectionId}" is not referenced by a page.`,
      );
    } else if (referenceCount > 1) {
      addIssue(
        issues,
        "DUPLICATE_SECTION_REFERENCE",
        ["sections"],
        `Section "${sectionId}" is referenced by more than one page.`,
      );
    }
  }

  const fieldReferenceCount = new Map<string, number>();
  for (const [sectionIndex, section] of spec.sections.entries()) {
    for (const fieldId of findDuplicates(section.fieldIds)) {
      addIssue(
        issues,
        "DUPLICATE_SECTION_FIELD_REFERENCE",
        ["sections", sectionIndex, "fieldIds"],
        `Section "${section.id}" repeats field "${fieldId}".`,
      );
    }

    for (const fieldId of section.fieldIds) {
      const field = fieldById.get(fieldId);
      if (field === undefined) {
        addIssue(
          issues,
          "UNKNOWN_FIELD_REFERENCE",
          ["sections", sectionIndex, "fieldIds"],
          `Section "${section.id}" references unknown field "${fieldId}".`,
        );
        continue;
      }

      fieldReferenceCount.set(
        fieldId,
        (fieldReferenceCount.get(fieldId) ?? 0) + 1,
      );

      if (
        field.placement.columnStart + field.placement.columnSpan - 1 >
        section.layout.columns
      ) {
        addIssue(
          issues,
          "FIELD_PLACEMENT_OUT_OF_BOUNDS",
          ["fields", spec.fields.indexOf(field), "placement"],
          `Field "${field.id}" exceeds section "${section.id}" column bounds.`,
        );
      }
    }
  }

  for (const fieldId of fieldIdSet) {
    const referenceCount = fieldReferenceCount.get(fieldId) ?? 0;
    if (referenceCount === 0) {
      addIssue(
        issues,
        "ORPHAN_FIELD",
        ["fields"],
        `Field "${fieldId}" is not referenced by a section.`,
      );
    } else if (referenceCount > 1) {
      addIssue(
        issues,
        "DUPLICATE_FIELD_REFERENCE",
        ["fields"],
        `Field "${fieldId}" is referenced by more than one section.`,
      );
    }
  }

  for (const [fieldIndex, field] of spec.fields.entries()) {
    if (
      field.type === "number" &&
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      addIssue(
        issues,
        "INVALID_NUMBER_FIELD_RANGE",
        ["fields", fieldIndex],
        `Number field "${field.id}" has min greater than max.`,
      );
    }

    if (field.type === "rating" && field.scale.min > field.scale.max) {
      addIssue(
        issues,
        "INVALID_RATING_SCALE",
        ["fields", fieldIndex, "scale"],
        `Rating field "${field.id}" has min greater than max.`,
      );
    }

    if (
      field.type === "radio" ||
      field.type === "select" ||
      field.type === "multiselect"
    ) {
      for (const optionValue of findDuplicates(
        field.options.map((option) => option.value),
      )) {
        addIssue(
          issues,
          "DUPLICATE_FIELD_OPTION_VALUE",
          ["fields", fieldIndex, "options"],
          `Field "${field.id}" repeats option value "${optionValue}".`,
        );
      }
    }

    if (field.type === "table") {
      for (const columnId of findDuplicates(
        field.columns.map((column) => column.id),
      )) {
        addIssue(
          issues,
          "DUPLICATE_TABLE_COLUMN_ID",
          ["fields", fieldIndex, "columns"],
          `Table field "${field.id}" repeats column id "${columnId}".`,
        );
      }
    }

    if (field.type === "resource") {
      const currentField = fieldById.get(field.currentFieldId);
      const maxField = fieldById.get(field.maxFieldId);

      if (currentField === undefined) {
        addIssue(
          issues,
          "UNKNOWN_RESOURCE_FIELD",
          ["fields", fieldIndex, "currentFieldId"],
          `Resource field "${field.id}" references unknown current field "${field.currentFieldId}".`,
        );
      } else if (!isNumericOrCalculatedField(currentField)) {
        addIssue(
          issues,
          "INVALID_RESOURCE_FIELD_TYPE",
          ["fields", fieldIndex, "currentFieldId"],
          "A resource current field must be numeric or calculated.",
        );
      }

      if (maxField === undefined) {
        addIssue(
          issues,
          "UNKNOWN_RESOURCE_FIELD",
          ["fields", fieldIndex, "maxFieldId"],
          `Resource field "${field.id}" references unknown max field "${field.maxFieldId}".`,
        );
      } else if (!isNumericOrCalculatedField(maxField)) {
        addIssue(
          issues,
          "INVALID_RESOURCE_FIELD_TYPE",
          ["fields", fieldIndex, "maxFieldId"],
          "A resource max field must be numeric or calculated.",
        );
      }

      if (field.currentFieldId === field.maxFieldId) {
        addIssue(
          issues,
          "RESOURCE_FIELDS_MUST_DIFFER",
          ["fields", fieldIndex],
          "A resource current field and max field must differ.",
        );
      }
    }
  }

  const valueEntries = Object.entries(spec.values);
  if (valueEntries.length > MAX_FIELD_VALUE_ENTRIES) {
    addIssue(
      issues,
      "TOO_MANY_FIELD_VALUES",
      ["values"],
      `Values may contain at most ${MAX_FIELD_VALUE_ENTRIES} entries.`,
    );
  }

  for (const [fieldId, value] of valueEntries.slice(
    0,
    MAX_FIELD_VALUE_ENTRIES,
  )) {
    const field = fieldById.get(fieldId);
    if (field === undefined) {
      addIssue(
        issues,
        "UNKNOWN_VALUE_FIELD",
        ["values", fieldId],
        `Values include unknown field "${fieldId}".`,
      );
      continue;
    }

    const invalidValueMessage = validateFieldValue(field, value);
    if (invalidValueMessage !== null) {
      addIssue(
        issues,
        "INVALID_FIELD_VALUE",
        ["values", fieldId],
        `Field "${fieldId}": ${invalidValueMessage}`,
      );
    }
  }

  if (spec.mode === "npc") {
    for (const field of spec.fields) {
      const hasValue = Object.hasOwn(spec.values, field.id);
      const value = spec.values[field.id];
      if (field.requiredForPlayableNpc && (!hasValue || value === null)) {
        addIssue(
          issues,
          "MISSING_PLAYABLE_NPC_VALUE",
          ["values", field.id],
          `NPC field "${field.id}" requires a playable value.`,
        );
      }
    }
  }

  const calculatedFieldReferences = new Map<string, string[]>();
  for (const [fieldIndex, field] of spec.fields.entries()) {
    if (field.type !== "calculated") {
      continue;
    }

    const references: string[] = [];
    collectFormulaFieldIds(field.formula, references);
    calculatedFieldReferences.set(field.id, references);

    for (const referencedFieldId of references) {
      if (!fieldIdSet.has(referencedFieldId)) {
        addIssue(
          issues,
          "UNKNOWN_FORMULA_FIELD",
          ["fields", fieldIndex, "formula"],
          `Calculated field "${field.id}" references unknown field "${referencedFieldId}".`,
        );
      }
    }
  }

  const calculatedFieldIds = new Set(calculatedFieldReferences.keys());

  const sectionIndexByFieldId = new Map<string, number>();
  for (const [sectionIndex, section] of spec.sections.entries()) {
    for (const fieldId of section.fieldIds) {
      sectionIndexByFieldId.set(fieldId, sectionIndex);
    }
  }

  for (const [fieldId, references] of calculatedFieldReferences) {
    const ownSectionIndex = sectionIndexByFieldId.get(fieldId);
    if (ownSectionIndex === undefined) {
      continue;
    }
    const calculatedFieldIndex = spec.fields.findIndex(
      (field) => field.id === fieldId,
    );
    for (const referencedFieldId of references) {
      if (!calculatedFieldIds.has(referencedFieldId)) {
        continue;
      }
      const referencedSectionIndex =
        sectionIndexByFieldId.get(referencedFieldId);
      if (
        referencedSectionIndex !== undefined &&
        referencedSectionIndex > ownSectionIndex
      ) {
        addIssue(
          issues,
          "FORMULA_FORWARD_REFERENCE",
          ["fields", calculatedFieldIndex, "formula"],
          `Calculated field "${fieldId}" references calculated field "${referencedFieldId}" from a later section.`,
        );
      }
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const traversal = [] as string[];
  const reportedCycleFields = new Set<string>();

  function visitCalculatedField(fieldId: string): void {
    if (active.has(fieldId)) {
      const cycleStart = traversal.indexOf(fieldId);
      for (const cycleFieldId of traversal.slice(cycleStart)) {
        if (!reportedCycleFields.has(cycleFieldId)) {
          reportedCycleFields.add(cycleFieldId);
          addIssue(
            issues,
            "FORMULA_CYCLE",
            [
              "fields",
              spec.fields.findIndex((field) => field.id === cycleFieldId),
              "formula",
            ],
            `Calculated field "${cycleFieldId}" participates in a formula cycle.`,
          );
        }
      }
      return;
    }

    if (visited.has(fieldId)) {
      return;
    }

    visited.add(fieldId);
    active.add(fieldId);
    traversal.push(fieldId);

    for (const referencedFieldId of calculatedFieldReferences.get(fieldId) ??
      []) {
      if (calculatedFieldIds.has(referencedFieldId)) {
        visitCalculatedField(referencedFieldId);
      }
    }

    traversal.pop();
    active.delete(fieldId);
  }

  for (const fieldId of calculatedFieldIds) {
    visitCalculatedField(fieldId);
  }

  const provenanceIndex = rulesContext
    ? createRulesContextProvenanceIndex(rulesContext)
    : undefined;

  if (
    rulesContext !== undefined &&
    rulesContext !== null &&
    spec.rulesContextId !== rulesContext.analysisId
  ) {
    addIssue(
      issues,
      "RULES_CONTEXT_ID_MISMATCH",
      ["rulesContextId"],
      "CharacterSheetSpec rulesContextId does not match the supplied RulesContext.",
    );
  }

  const sourceMapEntries = Object.entries(spec.sourceMap);
  if (sourceMapEntries.length > MAX_SOURCE_MAP_ENTRIES) {
    addIssue(
      issues,
      "TOO_MANY_SOURCE_MAP_ENTRIES",
      ["sourceMap"],
      `Source map may contain at most ${MAX_SOURCE_MAP_ENTRIES} entries.`,
    );
  }

  if (spec.rulesContextId === null && sourceMapEntries.length > 0) {
    addIssue(
      issues,
      "SOURCE_MAP_WITH_NULL_RULES_CONTEXT",
      ["sourceMap"],
      "A sheet without a RulesContext id must not carry rulebook provenance.",
    );
  }

  if (sourceMapEntries.length > 0 && provenanceIndex === undefined) {
    addIssue(
      issues,
      "PROVENANCE_CONTEXT_REQUIRED",
      ["sourceMap"],
      "RulesContext is required to validate source-map provenance.",
    );
  }

  for (const [fieldId, provenance] of sourceMapEntries.slice(
    0,
    MAX_SOURCE_MAP_ENTRIES,
  )) {
    if (!fieldIdSet.has(fieldId)) {
      addIssue(
        issues,
        "UNKNOWN_SOURCE_MAP_FIELD",
        ["sourceMap", fieldId],
        `Source map references unknown field "${fieldId}".`,
      );
    }

    let provenanceRuleBits = 0n;
    if (provenanceIndex !== undefined) {
      for (const ruleId of provenance.ruleIds) {
        const ruleBit = provenanceIndex.ruleBitsById.get(ruleId);
        if (ruleBit === undefined) {
          addIssue(
            issues,
            "UNKNOWN_SOURCE_MAP_RULE",
            ["sourceMap", fieldId, "ruleIds"],
            `Source map references unknown normalized rule "${ruleId}".`,
          );
        } else {
          provenanceRuleBits |= ruleBit;
        }
      }
    }

    if (provenanceIndex !== undefined) {
      for (const [citationIndex, citation] of (
        provenance.citations ?? []
      ).entries()) {
        const source = provenanceIndex.sourceById.get(citation.sourceId);
        if (source === undefined) {
          addIssue(
            issues,
            "UNKNOWN_SOURCE_MAP_CITATION_SOURCE",
            ["sourceMap", fieldId, "citations", citationIndex],
            `Source map citation references unknown source "${citation.sourceId}".`,
          );
          continue;
        }

        const lastReferencedPage = citation.pageEnd ?? citation.pageStart;
        if (
          source.type === "uploaded-rulebook" &&
          source.pageCount !== null &&
          lastReferencedPage !== null &&
          lastReferencedPage > source.pageCount
        ) {
          addIssue(
            issues,
            "SOURCE_MAP_CITATION_PAGE_OUT_OF_RANGE",
            ["sourceMap", fieldId, "citations", citationIndex],
            `Source map citation page ${lastReferencedPage} exceeds source page count ${source.pageCount}.`,
          );
        }

        const citationRuleBits = provenanceIndex.ruleBitsByCitationKey.get(
          getCitationKey(citation),
        );
        if (
          citationRuleBits === undefined ||
          (citationRuleBits & provenanceRuleBits) === 0n
        ) {
          addIssue(
            issues,
            "SOURCE_MAP_CITATION_NOT_LINKED_TO_RULE",
            ["sourceMap", fieldId, "citations", citationIndex],
            "Source map citation must match a citation from one of its normalized rules.",
          );
        }
      }
    }
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

/** Generates JSON Schema directly from the canonical Zod 4 schema. */
export function getCharacterSheetSpecJsonSchema() {
  return z.toJSONSchema(CharacterSheetSpecSchema, { reused: "ref" });
}
