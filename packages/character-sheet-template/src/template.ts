import { z } from "zod";

export const CHARACTER_SHEET_TEMPLATE_VERSION = 1;

/** Bounds enforced on an extracted template so a run stays bounded and cheap. */
export const MAX_TEMPLATE_SECTIONS = 12;
export const MAX_TEMPLATE_FIELDS = 192;
export const MAX_TEMPLATE_FIELD_LABEL_CHARS = 200;
export const MAX_TEMPLATE_TITLE_CHARS = 200;
export const MAX_TEMPLATE_PURPOSE_CHARS = 1_000;
export const MAX_TEMPLATE_SECTION_KEY_CHARS = 64;
export const MAX_TEMPLATE_SOURCE_KEY_CHARS = 128;
export const MAX_TEMPLATE_SOURCE_PAGE = 10_000;

/** BCP-47-ish locale with the same shape as the compiled metadata locale. */
export const TemplateLocaleSchema = z
  .string()
  .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export type TemplateLocale = z.infer<typeof TemplateLocaleSchema>;

/**
 * The sheet kind a template targets. It is intentionally distinct from the
 * compiled CharacterSheetSpec mode (player/npc) and from the authoring mode
 * (pc/npc): it describes the physical sheet the extractor read, so a direct
 * blank PC sheet and a rulebook-contained NPC sample sheet stay
 * distinguishable at the source level.
 */
export const TemplateModeSchema = z.enum(["pc", "npc"]);
export type TemplateMode = z.infer<typeof TemplateModeSchema>;

/**
 * Visual sections observed on the extracted sheet. They are presentation
 * grouping for the future authoring UI; they never override deterministic
 * compiled grouping (ADR-055/056 keep final construction server-owned).
 */
export const TemplateSectionSchema = z.strictObject({
  key: z
    .string()
    .min(2)
    .max(MAX_TEMPLATE_SECTION_KEY_CHARS)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Template section keys must be lowercase snake_case.",
    ),
  title: z.string().min(2).max(MAX_TEMPLATE_TITLE_CHARS).regex(/\S/),
  purpose: z
    .string()
    .min(1)
    .max(MAX_TEMPLATE_PURPOSE_CHARS)
    .regex(/\S/)
    .optional(),
});
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

const templateSectionsSchema = z
  .array(TemplateSectionSchema)
  .min(1)
  .max(MAX_TEMPLATE_SECTIONS)
  .superRefine((sections, context) => {
    const seen = new Set<string>();
    sections.forEach((section, index) => {
      if (seen.has(section.key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(index), "key"],
          message: `Template section key "${section.key}" repeats.`,
        });
      }
      seen.add(section.key);
    });
  });

/**
 * Field kinds mirror the compiled CharacterSheetSpec variants so the extracted
 * template keeps enough fidelity for the future visual UI without ever
 * carrying images, layout pixels, or rendered value data.
 */
export const TemplateFieldKindSchema = z.enum([
  "text",
  "number",
  "textarea",
  "checkbox",
  "radio",
  "select",
  "multiselect",
  "rating",
  "resource",
  "list",
  "table",
  "calculated",
  "image",
]);
export type TemplateFieldKind = z.infer<typeof TemplateFieldKindSchema>;

export const TemplateNumericBoundsSchema = z
  .strictObject({
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .superRefine((bounds, context) => {
    if (bounds.min > bounds.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message:
          "Template numeric bounds max must be greater than or equal to min.",
      });
    }
  });
export type TemplateNumericBounds = z.infer<typeof TemplateNumericBoundsSchema>;

/** One extracted field of the visual roster. Locale is inherited from the template context. */
export const TemplateFieldSchema = z
  .strictObject({
    label: z.string().min(1).max(MAX_TEMPLATE_FIELD_LABEL_CHARS).regex(/\S/),
    category: z.enum(["mechanical", "identity"]),
    kind: TemplateFieldKindSchema,
    sectionKey: z
      .string()
      .min(2)
      .max(MAX_TEMPLATE_SECTION_KEY_CHARS)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "Template section keys must be lowercase snake_case.",
      )
      .optional(),
    numericBounds: TemplateNumericBoundsSchema.optional(),
  })
  .superRefine((field, context) => {
    if (field.category === "identity" && field.numericBounds !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["numericBounds"],
        message: "Identity template fields must not carry numeric bounds.",
      });
    }
  });
export type TemplateField = z.infer<typeof TemplateFieldSchema>;

const templateFieldsSchema = z
  .array(TemplateFieldSchema)
  .min(1)
  .max(MAX_TEMPLATE_FIELDS)
  .superRefine((fields, context) => {
    const seenLabels = new Set<string>();
    fields.forEach((field, index) => {
      if (seenLabels.has(field.label)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(index), "label"],
          message: `Template field label "${field.label}" repeats.`,
        });
      }
      seenLabels.add(field.label);
    });
  });

/**
 * The raw extracted-template contract. This is the primary authority for which
 * fields exist on a generated sheet in the template-backed flow: the roster is
 * read from the sheet itself and never inferred from a whole rulebook.
 */
export const CharacterSheetTemplateSchema = z
  .strictObject({
    schemaVersion: z.literal(CHARACTER_SHEET_TEMPLATE_VERSION),
    mode: TemplateModeSchema,
    sections: templateSectionsSchema,
    fields: templateFieldsSchema,
  })
  .superRefine((template, context) => {
    const sectionKeys = new Set(
      template.sections.map((section) => section.key),
    );
    template.fields.forEach((field, index) => {
      if (
        field.sectionKey !== undefined &&
        !sectionKeys.has(field.sectionKey)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(index), "sectionKey"],
          message: `Template field "${field.label}" references unknown section "${field.sectionKey}".`,
        });
      }
    });
  });
export type CharacterSheetTemplate = z.infer<
  typeof CharacterSheetTemplateSchema
>;

export function getSheetTemplateJsonSchema() {
  return z.toJSONSchema(CharacterSheetTemplateSchema, { reused: "ref" });
}
