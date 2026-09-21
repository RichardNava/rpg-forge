import { z } from "zod";

export const EXTRACTED_CHARACTER_STRUCTURE_VERSION = "1" as const;
export const MAX_EXTRACTED_CHARACTER_PAGES = 3;
export const MAX_EXTRACTED_CHARACTER_NODES = 240;
export const MAX_EXTRACTED_CHARACTER_DEPTH = 12;
export const MAX_EXTRACTED_CHARACTER_LABEL_CHARS = 256;

const ExtractedValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().min(1).max(2_000)).min(1).max(100),
]);

const ExtractedConstraintsSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    options: z.array(z.string().min(1).max(128)).min(1).max(24).optional(),
  })
  .strict()
  .superRefine((constraints, context) => {
    if (
      constraints.min !== undefined &&
      constraints.max !== undefined &&
      constraints.min > constraints.max
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Observed minimum cannot exceed maximum.",
      });
    }
  });

export const ExtractedControlSchema = z
  .object({
    kind: z.enum([
      "text",
      "textarea",
      "number",
      "checkbox",
      "choice",
      "list",
      "rating",
    ]),
    constraints: ExtractedConstraintsSchema.optional(),
  })
  .strict()
  .superRefine((control, context) => {
    const constraints = control.constraints;
    if (
      constraints !== undefined &&
      control.kind !== "number" &&
      control.kind !== "rating" &&
      control.kind !== "choice"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only numeric, rating, and choice controls accept constraints.",
      });
    }
    if (constraints?.options !== undefined && control.kind !== "choice") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only choice controls accept observed options.",
      });
    }
  });
export type ExtractedControl = z.infer<typeof ExtractedControlSchema>;

export type ExtractedCharacterNode =
  ExtractedCharacterSection | ExtractedCharacterField;

export interface ExtractedCharacterSection {
  readonly kind: "section";
  readonly label: string;
  readonly children: readonly ExtractedCharacterNode[];
}

export interface ExtractedCharacterField {
  readonly kind: "field";
  readonly label: string;
  readonly control: ExtractedControl;
  readonly value?: z.infer<typeof ExtractedValueSchema> | undefined;
}

export const ExtractedCharacterNodeSchema: z.ZodType<ExtractedCharacterNode> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("section"),
        label: z
          .string()
          .trim()
          .min(1)
          .max(MAX_EXTRACTED_CHARACTER_LABEL_CHARS),
        children: z
          .array(ExtractedCharacterNodeSchema)
          .max(MAX_EXTRACTED_CHARACTER_NODES),
      }),
      z.strictObject({
        kind: z.literal("field"),
        label: z
          .string()
          .trim()
          .min(1)
          .max(MAX_EXTRACTED_CHARACTER_LABEL_CHARS),
        control: ExtractedControlSchema,
        value: ExtractedValueSchema.optional(),
      }),
    ]),
  );

export const ExtractedCharacterStructureSchema = z
  .strictObject({
    schemaVersion: z.literal(EXTRACTED_CHARACTER_STRUCTURE_VERSION),
    document: z.strictObject({
      pageCount: z.number().int().min(1).max(MAX_EXTRACTED_CHARACTER_PAGES),
    }),
    nodes: z
      .array(ExtractedCharacterNodeSchema)
      .min(1)
      .max(MAX_EXTRACTED_CHARACTER_NODES),
  })
  .superRefine((structure, context) => {
    const counts = countTree(structure.nodes);
    if (counts.nodes > MAX_EXTRACTED_CHARACTER_NODES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Observed structure exceeds the node budget.",
      });
    }
    if (counts.maxDepth > MAX_EXTRACTED_CHARACTER_DEPTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Observed structure exceeds the maximum hierarchy depth.",
      });
    }
  });
export type ExtractedCharacterStructure = z.infer<
  typeof ExtractedCharacterStructureSchema
>;

function countTree(
  nodes: readonly ExtractedCharacterNode[],
  depth = 1,
): {
  nodes: number;
  maxDepth: number;
} {
  let count = 0;
  let maxDepth = 0;
  for (const node of nodes) {
    count += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (node.kind === "section") {
      const descendants = countTree(node.children, depth + 1);
      count += descendants.nodes;
      maxDepth = Math.max(maxDepth, descendants.maxDepth);
    }
  }
  return { nodes: count, maxDepth };
}
