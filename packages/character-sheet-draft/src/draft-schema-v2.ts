import { z } from "zod";
import { draftError } from "./errors";
import {
  MAX_DRAFT_SURFACE_FIELDS,
  MAX_DRAFT_VALUES_FIELDS,
  MAX_DRAFT_FIELD_KEY_CHARS,
  MAX_DRAFT_FIELD_LABEL_CHARS,
  MAX_DRAFT_TEXT_VALUE_CHARS,
  MAX_DRAFT_CHOICE_OPTIONS,
  MAX_DRAFT_CHOICE_OPTION_CHARS,
  MAX_DRAFT_SOURCE_ID_CHARS,
  MAX_DRAFT_SECTIONS,
  MAX_DRAFT_SECTION_DEPTH,
  MAX_DRAFT_LIST_ITEMS,
  DraftIdentitySchema,
  type DraftIdentity,
  DraftFieldTypeSchema,
  type DraftFieldType,
  DraftValueSchema,
  type DraftValue,
  DraftFieldSchema,
  type DraftField,
  DraftSourceSchema,
  type DraftSource,
} from "./draft-schema";

export const CHARACTER_SHEET_DRAFT_V2_VERSION = "2" as const;

export const draftKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** V2 Section contains ONLY key and title. No parentKey, no fieldKeys. */
export const DraftSectionV2Schema = z.strictObject({
  key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS).regex(draftKeyPattern),
  title: z.string().min(1).max(MAX_DRAFT_FIELD_LABEL_CHARS).regex(/\S/),
});
export type DraftSectionV2 = z.infer<typeof DraftSectionV2Schema>;

/** V2 Placement is the ONLY structural authority. */
export const DraftPlacementKindSchema = z.enum(["field", "section"]);

export const DraftPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("field"),
    key: z
      .string()
      .min(1)
      .max(MAX_DRAFT_FIELD_KEY_CHARS)
      .regex(draftKeyPattern),
    parentKey: z
      .string()
      .min(1)
      .max(MAX_DRAFT_FIELD_KEY_CHARS)
      .regex(draftKeyPattern)
      .nullable(),
  }),
  z.strictObject({
    kind: z.literal("section"),
    key: z
      .string()
      .min(1)
      .max(MAX_DRAFT_FIELD_KEY_CHARS)
      .regex(draftKeyPattern),
    parentKey: z
      .string()
      .min(1)
      .max(MAX_DRAFT_FIELD_KEY_CHARS)
      .regex(draftKeyPattern)
      .nullable(),
  }),
]);
export type DraftPlacement = z.infer<typeof DraftPlacementSchema>;

/** V2 Draft: CONTENT registries + REQUIRED structure[] as canonical preorder. */
export const CharacterSheetDraftV2Schema = z
  .strictObject({
    schemaVersion: z.literal(CHARACTER_SHEET_DRAFT_V2_VERSION),
    draftId: DraftIdentitySchema,
    sessionId: DraftIdentitySchema,
    baseVersion: z.number().int().min(1),
    version: z.number().int().min(1),
    mode: z.enum(["pc", "npc"]),
    characterName: z.string().max(256).nullable(),
    rulesContextId: z.string().max(128).nullable(),
    fields: z.array(DraftFieldSchema).min(1).max(MAX_DRAFT_SURFACE_FIELDS),
    sections: z.array(DraftSectionV2Schema).max(MAX_DRAFT_SECTIONS),
    structure: z.array(DraftPlacementSchema),
    values: z
      .record(z.string(), DraftValueSchema)
      .superRefine((value, context) => {
        if (Object.keys(value).length > MAX_DRAFT_VALUES_FIELDS) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A draft may carry at most ${MAX_DRAFT_VALUES_FIELDS} values.`,
          });
        }
      }),
    source: DraftSourceSchema,
    confirmed: z.boolean().default(false),
  })
  .superRefine((draft, context) => {
    const fieldKeys = new Set(draft.fields.map((f) => f.key));
    if (fieldKeys.size !== draft.fields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Draft field keys must be unique.",
      });
    }
    const sectionKeys = new Set(draft.sections.map((s) => s.key));
    if (sectionKeys.size !== draft.sections.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Draft section keys must be unique.",
      });
    }
    for (const sectionKey of sectionKeys) {
      if (fieldKeys.has(sectionKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Key "${sectionKey}" is used by both a field and a section.`,
        });
      }
    }

    const structure = draft.structure;
    const placementKeys = new Set<string>();

    for (const placement of structure) {
      const compositeKey = `${placement.kind}:${placement.key}`;
      if (placementKeys.has(compositeKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate placement for ${placement.kind} "${placement.key}".`,
        });
      }
      placementKeys.add(compositeKey);

      if (placement.kind === "field") {
        if (!fieldKeys.has(placement.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Field placement references unknown field "${placement.key}".`,
          });
        }
      } else {
        if (!sectionKeys.has(placement.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Section placement references unknown section "${placement.key}".`,
          });
        }
      }

      if (placement.parentKey !== null) {
        if (!sectionKeys.has(placement.parentKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Placement for ${placement.kind} "${placement.key}" references unknown parent section "${placement.parentKey}".`,
          });
        }
        if (placement.parentKey === placement.key) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Node "${placement.key}" cannot parent itself.`,
          });
        }
      }
    }

    const fieldPlacements = structure.filter((p) => p.kind === "field");
    const sectionPlacements = structure.filter((p) => p.kind === "section");
    if (fieldPlacements.length !== draft.fields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every field must have exactly one placement.",
      });
    }
    if (sectionPlacements.length !== draft.sections.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every section must have exactly one placement.",
      });
    }

    const parentMap = new Map<string, string | null>();
    for (const placement of structure) {
      if (placement.kind === "section") {
        parentMap.set(placement.key, placement.parentKey);
      }
    }

    for (const section of draft.sections) {
      let depth = 0;
      let current = parentMap.get(section.key);
      const visited = new Set<string>([section.key]);
      while (current !== null && current !== undefined) {
        if (visited.has(current) || depth >= MAX_DRAFT_SECTION_DEPTH) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Section "${section.key}" has an invalid parent hierarchy.`,
          });
          break;
        }
        visited.add(current);
        current = parentMap.get(current);
        depth += 1;
      }
      if (depth > MAX_DRAFT_SECTION_DEPTH) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Section "${section.key}" exceeds maximum depth of ${MAX_DRAFT_SECTION_DEPTH}.`,
        });
      }
    }

    const expectedOrder = computeExpectedPreorder(draft);
    if (JSON.stringify(expectedOrder) !== JSON.stringify(structure)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Structure array is not in valid preorder or has non-contiguous subtrees.",
      });
    }

    for (const entry of Object.keys(draft.values)) {
      if (!fieldKeys.has(entry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Draft values reference unknown key "${entry}".`,
        });
      }
    }
    const nameValue =
      draft.values["character_name"] === undefined
        ? null
        : draft.values["character_name"];
    if (nameValue !== null && typeof nameValue !== "string") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The character_name value must be a string or null.",
      });
    } else if (draft.characterName !== nameValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "characterName must mirror the character_name value.",
      });
    }
  });
export type CharacterSheetDraftV2 = z.infer<typeof CharacterSheetDraftV2Schema>;

function computeExpectedPreorder(
  draft: CharacterSheetDraftV2,
): DraftPlacement[] {
  const result: DraftPlacement[] = [];
  const childrenByParent = new Map<string | null, DraftPlacement[]>();
  for (const placement of draft.structure) {
    const parentKey = placement.parentKey ?? null;
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, []);
    }
    childrenByParent.get(parentKey)!.push(placement);
  }
  function visit(parentKey: string | null) {
    const children = childrenByParent.get(parentKey) ?? [];
    for (const child of children) {
      result.push(child);
      if (child.kind === "section") {
        visit(child.key);
      }
    }
  }
  visit(null);
  return result;
}

export function validateDraftV2(value: unknown): CharacterSheetDraftV2 {
  const result = CharacterSheetDraftV2Schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_draft",
      first === undefined
        ? "The V2 draft is invalid."
        : `The V2 draft is invalid: ${first.message}`,
    );
  }
  return result.data;
}
