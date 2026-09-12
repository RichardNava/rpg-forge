import { NormalizedRuleIdSchema } from "@repo/rules-context";
import { z } from "zod";
import {
  MAX_CALC_AST_DEPTH,
  MAX_CALCULATIONS,
  MAX_FIELDS_PER_SECTION,
  MAX_OPTIONS_PER_CHOICE,
  MAX_PLAN_SECTIONS,
  MAX_REFERENCED_RULES_PER_FIELD,
  MAX_REFERENCED_RULES_PER_SECTION,
  MAX_TABLE_COLUMNS,
  SHEET_GENERATION_CALCULATIONS_ARTIFACT_VERSION,
  SHEET_GENERATION_FIELDS_ARTIFACT_VERSION,
  SHEET_GENERATION_SECTION_PLAN_ARTIFACT_VERSION,
} from "./model.js";

/**
 * Symbolic keys are the only identifiers the model ever emits. They are
 * lowercase snake_case, bounded, and never collide with opaque server-minted
 * ids. The deterministic compiler maps them onto canonical final identifiers.
 */
export const SymbolicKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Symbolic keys must be lowercase snake_case.");

export type SymbolicKey = z.infer<typeof SymbolicKeySchema>;

const labelSchema = z.string().min(2).max(200).regex(/\S/);
const shortLabelSchema = z.string().min(1).max(120).regex(/\S/);
const fieldLabelSchema = z.string().min(2).max(120).regex(/\S/);

export const SectionPlanSectionSchema = z.strictObject({
  key: SymbolicKeySchema,
  title: labelSchema,
  purpose: z.string().min(1).max(1_000).regex(/\S/),
  ruleIds: z
    .array(NormalizedRuleIdSchema)
    .max(MAX_REFERENCED_RULES_PER_SECTION)
    .default([]),
});
export type SectionPlanSection = z.infer<typeof SectionPlanSectionSchema>;

export const SectionPlanOutputSchema = z.strictObject({
  mode: z.enum(["player", "npc"]).default("player"),
  sections: z.array(SectionPlanSectionSchema).min(1).max(MAX_PLAN_SECTIONS),
});
export type SectionPlanOutput = z.infer<typeof SectionPlanOutputSchema>;

export const FieldOptionCandidateSchema = z.strictObject({
  value: SymbolicKeySchema,
  label: shortLabelSchema,
});
export type FieldOptionCandidate = z.infer<typeof FieldOptionCandidateSchema>;

const numericBoundsSchema = z
  .strictObject({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
  })
  .superRefine((bounds, context) => {
    if (
      bounds.min !== undefined &&
      bounds.max !== undefined &&
      bounds.min > bounds.max
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "A numeric field max must be greater than or equal to min.",
      });
    }
  });

const ratingScaleSchema = z
  .strictObject({
    min: z.number().int().min(0).max(100),
    max: z.number().int().min(0).max(100),
    step: z.number().int().positive().max(100),
  })
  .superRefine((scale, context) => {
    if (scale.min > scale.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "A rating scale max must be greater than or equal to min.",
      });
    }
  });

const choiceOptionsSchema = z
  .array(FieldOptionCandidateSchema)
  .min(1)
  .max(MAX_OPTIONS_PER_CHOICE)
  .superRefine((options, context) => {
    const seen = new Set<string>();
    for (const option of options) {
      if (seen.has(option.value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(options.indexOf(option)), "value"],
          message: `Field option value "${option.value}" repeats.`,
        });
      }
      seen.add(option.value);
    }
  });

export const FieldDependencyReferenceSchema = z
  .strictObject({
    currentFieldKey: SymbolicKeySchema,
    maxFieldKey: SymbolicKeySchema,
  })
  .superRefine((references, context) => {
    if (references.currentFieldKey === references.maxFieldKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxFieldKey"],
        message: "A resource current and max field must differ.",
      });
    }
  });
export type FieldDependencyReference = z.infer<
  typeof FieldDependencyReferenceSchema
>;

export const FieldCandidateBaseSchema = z.strictObject({
  key: SymbolicKeySchema,
  label: fieldLabelSchema,
  ruleIds: z
    .array(NormalizedRuleIdSchema)
    .max(MAX_REFERENCED_RULES_PER_FIELD)
    .default([]),
  requiredForPlayableNpc: z.boolean().default(false),
  breakBefore: z.boolean().default(false),
});

/** Referenced percentages and ratios stay symbolic so the compiler owns layout. */
const slotSchema = z.strictObject({
  aspectRatio: z
    .enum(["square", "portrait", "landscape", "free"])
    .default("square"),
  maxColumnSpan: z.number().int().min(1).max(4).default(1),
  altText: shortLabelSchema.nullable().default(null),
});

export const FieldCandidateSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(10_000).optional(),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("number"),
    ...numericBoundsSchema.shape,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("textarea"),
    rows: z.number().int().min(1).max(20).optional(),
    displayIntent: z.enum(["notes", "description", "narrative"]).optional(),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("checkbox"),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("radio"),
    options: choiceOptionsSchema,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("select"),
    options: choiceOptionsSchema,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("multiselect"),
    options: choiceOptionsSchema,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("rating"),
    scale: ratingScaleSchema,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("resource"),
    references: FieldDependencyReferenceSchema,
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("list"),
    itemLabel: shortLabelSchema,
    maxItems: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("table"),
    columns: z
      .array(
        z.strictObject({
          id: SymbolicKeySchema,
          label: shortLabelSchema,
          valueType: z.enum(["text", "number", "checkbox"]),
        }),
      )
      .min(1)
      .max(MAX_TABLE_COLUMNS),
    maxRows: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("calculated"),
  }),
  z.strictObject({
    ...FieldCandidateBaseSchema.shape,
    type: z.literal("image"),
    slot: slotSchema,
  }),
]);
export type FieldCandidate = z.infer<typeof FieldCandidateSchema>;

export const FieldCandidatesOutputSchema = z.strictObject({
  fields: z.array(FieldCandidateSchema).min(1).max(MAX_FIELDS_PER_SECTION),
});
export type FieldCandidatesOutput = z.infer<typeof FieldCandidatesOutputSchema>;

// Private recursive typing aids for schema construction; the public type is
// inferred from the schema below.
type CalculationExpressionAst =
  | { op: "literal"; value: number }
  | { op: "field"; fieldKey: string }
  | {
      op: "add";
      left: CalculationExpressionAst;
      right: CalculationExpressionAst;
    }
  | {
      op: "subtract";
      left: CalculationExpressionAst;
      right: CalculationExpressionAst;
    }
  | {
      op: "multiply";
      left: CalculationExpressionAst;
      right: CalculationExpressionAst;
    }
  | {
      op: "divide";
      left: CalculationExpressionAst;
      right: CalculationExpressionAst;
    }
  | { op: "min"; values: CalculationExpressionAst[] }
  | { op: "max"; values: CalculationExpressionAst[] }
  | { op: "floor"; value: CalculationExpressionAst }
  | { op: "ceil"; value: CalculationExpressionAst }
  | { op: "round"; value: CalculationExpressionAst }
  | {
      op: "conditional";
      condition: CalculationConditionAst;
      whenTrue: CalculationExpressionAst;
      whenFalse: CalculationExpressionAst;
    };

type CalculationConditionAst = {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  left: CalculationExpressionAst;
  right: CalculationExpressionAst;
};

function createCalculationConditionSchema(
  schema: z.ZodType<CalculationExpressionAst>,
): z.ZodType<CalculationConditionAst> {
  return z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("eq"),
      left: schema,
      right: schema,
    }),
    z.strictObject({
      op: z.literal("neq"),
      left: schema,
      right: schema,
    }),
    z.strictObject({
      op: z.literal("gt"),
      left: schema,
      right: schema,
    }),
    z.strictObject({
      op: z.literal("gte"),
      left: schema,
      right: schema,
    }),
    z.strictObject({
      op: z.literal("lt"),
      left: schema,
      right: schema,
    }),
    z.strictObject({
      op: z.literal("lte"),
      left: schema,
      right: schema,
    }),
  ]);
}

function createCalculationExpressionSchema(
  remainingDepth: number,
): z.ZodType<CalculationExpressionAst> {
  const terminalSchemas = [
    z.strictObject({
      op: z.literal("literal"),
      value: z.number().finite(),
    }),
    z.strictObject({
      op: z.literal("field"),
      fieldKey: SymbolicKeySchema,
    }),
  ] as const;

  if (remainingDepth === 0) {
    return z.discriminatedUnion("op", terminalSchemas);
  }

  const nestedSchema = createCalculationExpressionSchema(remainingDepth - 1);
  const nestedConditionSchema = createCalculationConditionSchema(nestedSchema);

  return z.discriminatedUnion("op", [
    ...terminalSchemas,
    z.strictObject({
      op: z.literal("add"),
      left: nestedSchema,
      right: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("subtract"),
      left: nestedSchema,
      right: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("multiply"),
      left: nestedSchema,
      right: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("divide"),
      left: nestedSchema,
      right: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("floor"),
      value: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("ceil"),
      value: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("round"),
      value: nestedSchema,
    }),
    z.strictObject({
      op: z.literal("min"),
      values: z.array(nestedSchema).min(1).max(32),
    }),
    z.strictObject({
      op: z.literal("max"),
      values: z.array(nestedSchema).min(1).max(32),
    }),
    z.strictObject({
      op: z.literal("conditional"),
      condition: nestedConditionSchema,
      whenTrue: nestedSchema,
      whenFalse: nestedSchema,
    }),
  ]);
}

/** Safe symbolic expression AST; the compiler maps fieldKey onto canonical ids. */
export const CalculationExpressionSchema =
  createCalculationExpressionSchema(MAX_CALC_AST_DEPTH);

export type CalculationExpression = z.infer<typeof CalculationExpressionSchema>;

export const CalculationCandidateSchema = z.strictObject({
  key: SymbolicKeySchema,
  label: fieldLabelSchema,
  ruleIds: z
    .array(NormalizedRuleIdSchema)
    .max(MAX_REFERENCED_RULES_PER_FIELD)
    .default([]),
  displayFormat: z.enum(["number", "integer", "percent"]).optional(),
  expression: CalculationExpressionSchema,
});
export type CalculationCandidate = z.infer<typeof CalculationCandidateSchema>;

export const CalculationCandidatesOutputSchema = z.strictObject({
  calculations: z.array(CalculationCandidateSchema).max(MAX_CALCULATIONS),
});
export type CalculationCandidatesOutput = z.infer<
  typeof CalculationCandidatesOutputSchema
>;

/**
 * One entry of the deterministic per-run field index the calculations stage
 * hands to both the prompt and the validator. `sectionOrder` is the section's
 * position in the plan, so forward references among calculated fields are
 * knowable before compilation.
 */
export interface CalculationFieldIndexEntry {
  readonly key: string;
  readonly label: string;
  readonly type: FieldCandidate["type"];
  readonly sectionKey: string;
  readonly sectionOrder: number;
}

/**
 * Persisted generation-scoped artifacts. Each is versioned and carries the run
 * identity so a stale run can never read another run's objects.
 */
export const SheetGenerationSectionPlanArtifactSchema = z.strictObject({
  version: z.literal(SHEET_GENERATION_SECTION_PLAN_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  plan: SectionPlanOutputSchema,
});
export type SheetGenerationSectionPlanArtifact = z.infer<
  typeof SheetGenerationSectionPlanArtifactSchema
>;

export const SheetGenerationFieldsArtifactSchema = z.strictObject({
  version: z.literal(SHEET_GENERATION_FIELDS_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  sectionKey: SymbolicKeySchema,
  fields: z.array(FieldCandidateSchema).min(1).max(MAX_FIELDS_PER_SECTION),
});
export type SheetGenerationFieldsArtifact = z.infer<
  typeof SheetGenerationFieldsArtifactSchema
>;

export const SheetGenerationCalculationsArtifactSchema = z.strictObject({
  version: z.literal(SHEET_GENERATION_CALCULATIONS_ARTIFACT_VERSION),
  runId: z.uuid(),
  analysisId: z.uuid(),
  calculations: z.array(CalculationCandidateSchema).max(MAX_CALCULATIONS),
});
export type SheetGenerationCalculationsArtifact = z.infer<
  typeof SheetGenerationCalculationsArtifactSchema
>;

export function getSectionPlanJsonSchema() {
  return z.toJSONSchema(SectionPlanOutputSchema, { reused: "ref" });
}

export function getFieldCandidatesJsonSchema() {
  return z.toJSONSchema(FieldCandidatesOutputSchema, { reused: "ref" });
}

export function getCalculationCandidatesJsonSchema() {
  return z.toJSONSchema(CalculationCandidatesOutputSchema, { reused: "ref" });
}
