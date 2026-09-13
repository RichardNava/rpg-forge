import { z } from "zod";
import {
  MAX_TEMPLATE_SOURCE_KEY_CHARS,
  MAX_TEMPLATE_SOURCE_PAGE,
  TemplateLocaleSchema,
  type TemplateLocale,
} from "./template.js";

/**
 * Where an extracted template comes from. `sheetKey`/`rulebookKey` are opaque
 * server-side references (future R2 objects at 14.7D); they are never paths,
 * URLs, or file names and are not resolved by this package.
 */
const commonSourceFields = {
  locale: TemplateLocaleSchema.optional(),
} as const;

export const DirectSheetSourceSchema = z.strictObject({
  kind: z.literal("direct-sheet"),
  sheetKey: z.string().min(1).max(MAX_TEMPLATE_SOURCE_KEY_CHARS).regex(/\S/),
  ...commonSourceFields,
});
export type DirectSheetSource = z.infer<typeof DirectSheetSourceSchema>;

export const RulebookContainedSheetSourceSchema = z
  .strictObject({
    kind: z.literal("rulebook-contained-sheet"),
    rulebookKey: z
      .string()
      .min(1)
      .max(MAX_TEMPLATE_SOURCE_KEY_CHARS)
      .regex(/\S/),
    pageStart: z.number().int().min(1).max(MAX_TEMPLATE_SOURCE_PAGE).optional(),
    pageEnd: z.number().int().min(1).max(MAX_TEMPLATE_SOURCE_PAGE).optional(),
    ...commonSourceFields,
  })
  .superRefine((source, context) => {
    if (
      source.pageStart !== undefined &&
      source.pageEnd !== undefined &&
      source.pageStart > source.pageEnd
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageEnd"],
        message:
          "A rulebook page range end must be greater than or equal to its start.",
      });
    }
  });
export type RulebookContainedSheetSource = z.infer<
  typeof RulebookContainedSheetSourceSchema
>;

export const CharacterSheetTemplateSourceSchema = z.discriminatedUnion("kind", [
  DirectSheetSourceSchema,
  RulebookContainedSheetSourceSchema,
]);
export type CharacterSheetTemplateSource = z.infer<
  typeof CharacterSheetTemplateSourceSchema
>;

export type CharacterSheetTemplateSourceKind =
  CharacterSheetTemplateSource["kind"];
