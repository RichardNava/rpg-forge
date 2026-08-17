import { z } from "zod";

const shortText = z.string().trim().min(1).max(500);

export const ruleAnalysisSpikeResultSchema = z
  .strictObject({
    characterIntent: z
      .strictObject({
        summary: shortText,
      })
      .nullable(),
    ruleOverrides: z
      .array(
        z.strictObject({
          key: z.string().trim().min(1).max(80),
          value: z.string().trim().min(1).max(160),
        }),
      )
      .max(8),
    rules: z
      .array(
        z.strictObject({
          key: z.string().trim().min(1).max(80),
          summary: shortText,
          page: z.number().int().positive().max(12),
        }),
      )
      .max(12),
  })
  .superRefine((value, ctx) => {
    const ruleKeys = value.rules.map((r) => r.key);
    const duplicateRuleKeys = ruleKeys.filter(
      (key, index) => ruleKeys.indexOf(key) !== index,
    );
    for (const key of [...new Set(duplicateRuleKeys)]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate rule key "${key}".`,
        path: ["rules"],
      });
    }

    const overrideKeys = value.ruleOverrides.map((o) => o.key);
    const duplicateOverrideKeys = overrideKeys.filter(
      (key, index) => overrideKeys.indexOf(key) !== index,
    );
    for (const key of [...new Set(duplicateOverrideKeys)]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate override key "${key}".`,
        path: ["ruleOverrides"],
      });
    }
  });

export type RuleAnalysisSpikeResult = z.infer<
  typeof ruleAnalysisSpikeResultSchema
>;

const spikeFieldSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  fieldType: z.enum(["text", "number", "checkbox", "textarea"]),
});

export const characterSheetSpikeSpecSchema = z
  .strictObject({
    mode: z.enum(["blank", "prefilled"]),
    pages: z
      .array(
        z.strictObject({
          pageNumber: z.number().int().positive().max(2),
          sectionIds: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
        }),
      )
      .min(1)
      .max(2),
    sections: z
      .array(
        z.strictObject({
          id: z.string().trim().min(1).max(80),
          title: z.string().trim().min(1).max(100),
          fieldIds: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
        }),
      )
      .min(1)
      .max(6),
    fields: z.array(spikeFieldSchema).min(1).max(24),
    theme: z.strictObject({
      name: z.string().trim().min(1).max(80),
      accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }),
  })
  .superRefine((value, ctx) => {
    const sectionIds = value.sections.map((s) => s.id);
    const fieldIds = value.fields.map((f) => f.id);

    const duplicateSectionIds = sectionIds.filter(
      (id, index) => sectionIds.indexOf(id) !== index,
    );
    for (const id of [...new Set(duplicateSectionIds)]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate section id "${id}".`,
        path: ["sections"],
      });
    }

    const duplicateFieldIds = fieldIds.filter(
      (id, index) => fieldIds.indexOf(id) !== index,
    );
    for (const id of [...new Set(duplicateFieldIds)]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate field id "${id}".`,
        path: ["fields"],
      });
    }

    for (const [pageIndex, page] of value.pages.entries()) {
      for (const sectionId of page.sectionIds) {
        if (!sectionIds.includes(sectionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Page ${page.pageNumber} references unknown section "${sectionId}".`,
            path: ["pages", pageIndex, "sectionIds"],
          });
        }
      }
    }

    for (const [sectionIndex, section] of value.sections.entries()) {
      for (const fieldId of section.fieldIds) {
        if (!fieldIds.includes(fieldId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Section "${section.id}" references unknown field "${fieldId}".`,
            path: ["sections", sectionIndex, "fieldIds"],
          });
        }
      }
    }
  });

export type CharacterSheetSpikeSpec = z.infer<
  typeof characterSheetSpikeSpecSchema
>;
