import { TemplateFieldKindSchema } from "@repo/character-sheet-template";
import {
  NormalizedRuleIdSchema,
  RuleCitationSchema,
} from "@repo/rules-context";
import { z } from "zod";
import {
  AuthoredFieldLabelSchema,
  CharacterNameSchema,
  CharacterSheetAuthoringModeSchema,
  NPCDispositionSchema,
  NPCThreatLevelSchema,
} from "./authoring.js";
import { SymbolicKeySchema } from "./intermediate.js";
import {
  MAX_REFERENCED_RULES_PER_FIELD,
  MAX_PLAN_SECTIONS,
  MAX_TOTAL_FIELDS,
} from "./model.js";

export const MAX_SOURCE_CITATIONS_PER_FIELD = 64;
export const MAX_OVERRIDE_STRING_VALUE_CHARS = 10_000;
export const MAX_EXPLICIT_INPUT_OVERRIDES = 64;
export const MAX_GENERATION_CONFLICTS = 128;
export const MAX_CONFLICT_SOURCE_LABELS = 8;

/**
 * Canonical keys are the single deduplication identity of normalized fields.
 * They are deterministic, conservative, and never derived from model output:
 * no synonyms, no fuzzy matching, no notion matching. A label that differs in
 * meaning differs in key.
 */
export const CanonicalFieldKeySchema = SymbolicKeySchema;
export type CanonicalFieldKey = z.infer<typeof CanonicalFieldKeySchema>;

const CANONICAL_KEY_MAX_LENGTH = 64;
const FINGERPRINT_LENGTH = 12;
const SLUG_BUDGET = CANONICAL_KEY_MAX_LENGTH - FINGERPRINT_LENGTH - 1;

/** Characters a lossless ASCII slug can carry; space maps to the word separator. */
const ASCII_SLUG_SAFE = /^[a-z0-9_ ]*$/;

/**
 * Stable 64-bit FNV-1a fingerprint rendered as lowercase hex. It never
 * approximates, matches, or maps meaning: it is only a deterministic tag
 * derived from the normalized original label, used when ASCII conversion
 * would otherwise discard information.
 */
function stableLabelFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0").slice(0, FINGERPRINT_LENGTH);
}

/**
 * Deterministic label->key normalizer. NFKD folding with diacritics stripped,
 * lowercase, whitespace collapsed, then a lossless ASCII slug where possible.
 *
 * Invariant: the same normalized source label yields the same structural
 * identity, and distinct labels never collide merely because ASCII conversion
 * discarded information. When the normalized label is not ASCII-safe, empty, or
 * too long to truncate without loss, the always-safe slug is suffixed with a
 * stable fingerprint of the full normalized label. Latin folding such as
 * Énergie -> energie remains within the folding policy; scripts that do not
 * fold (戦闘, Воля, Сила) carry distinct fingerprint-suffixed keys. Playback
 * labels stay untouched: canonical keys are private structural identity only.
 *
 * The fingerprint is FNV-1a over the full normalized label, used purely to
 * disambiguate slugs that would otherwise collide after lossy ASCII
 * conversion. It is a correlational-quality tag, NOT a globally collision-proof
 * content hash; the MVP accepts that smaller risk in exchange for staying
 * dependency- and crypto-free and deterministic on every supported runtime.
 */
export function canonicalizeFieldLabel(label: string): CanonicalFieldKey {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const fingerprint = stableLabelFingerprint(normalized);
  let slug = normalized
    .split(" ")
    .filter((part) => part.length > 0)
    .join("_");
  slug = slug.replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "");

  if (slug.length === 0) {
    return `field_${fingerprint}`;
  }

  const asciiSafe = ASCII_SLUG_SAFE.test(normalized);
  if (!asciiSafe || slug.length > SLUG_BUDGET) {
    let prefix = slug;
    if (/^[0-9]/.test(prefix)) {
      prefix = `field_${prefix}`;
    }
    return `${prefix.slice(0, SLUG_BUDGET)}_${fingerprint}`;
  }

  if (/^[0-9]/.test(slug)) {
    return `field_${slug}`;
  }

  return slug;
}

/** Mechanical fields are game-facing stats; identity traits are character-facing elaboration. */
export const FieldCategorySchema = z.enum(["mechanical", "identity"]);
export type FieldCategory = z.infer<typeof FieldCategorySchema>;

export const SheetFieldOriginSchema = z.enum([
  "gui",
  "rulebook",
  "context-override",
  "ai-default",
  "sheet-template",
]);
export type SheetFieldOrigin = z.infer<typeof SheetFieldOriginSchema>;

/**
 * Private per-field source trail. Origin + rule evidence describes how the
 * field came to be; the authority of each origin is fixed by construction, so
 * equal-authority disagreements are detectible mechanically.
 */
export const SheetFieldSourceProvenanceSchema = z
  .strictObject({
    origins: z.array(SheetFieldOriginSchema).min(1).max(4),
    ruleIds: z
      .array(NormalizedRuleIdSchema)
      .max(MAX_REFERENCED_RULES_PER_FIELD)
      .optional(),
    citations: z
      .array(RuleCitationSchema)
      .max(MAX_SOURCE_CITATIONS_PER_FIELD)
      .optional(),
  })
  .superRefine((provenance, context) => {
    if (!provenance.origins.includes("rulebook")) {
      if (provenance.ruleIds !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ruleIds"],
          message: "Rule evidence requires a rulebook origin.",
        });
      }
      if (provenance.citations !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["citations"],
          message: "Rule citations require a rulebook origin.",
        });
      }
    }
  });
export type SheetFieldSourceProvenance = z.infer<
  typeof SheetFieldSourceProvenanceSchema
>;

export const NumericValueRangeSchema = z
  .strictObject({
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .superRefine((range, context) => {
    if (range.min > range.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "A numeric range max must be greater than or equal to min.",
      });
    }
  });
export type NumericValueRange = z.infer<typeof NumericValueRangeSchema>;

/** The private, pre-compilation identity of a single sheet field. */
export const SourceResolvedFieldSchema = z
  .strictObject({
    canonicalKey: CanonicalFieldKeySchema,
    label: AuthoredFieldLabelSchema,
    category: FieldCategorySchema,
    explicitValue: z
      .union([
        z.number().finite(),
        z.string().max(MAX_OVERRIDE_STRING_VALUE_CHARS),
      ])
      .nullable()
      .optional(),
    permittedValueRange: NumericValueRangeSchema.optional(),
    /** Template-proposed field kind; only the payload-free kinds compile directly. */
    kind: TemplateFieldKindSchema.optional(),
    /** Template-proposed logical section the field belongs to. */
    sectionKey: SymbolicKeySchema.optional(),
    provenance: SheetFieldSourceProvenanceSchema,
  })
  .superRefine((field, context) => {
    if (field.category === "identity") {
      if (field.explicitValue !== undefined && field.explicitValue !== null) {
        if (typeof field.explicitValue === "number") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["explicitValue"],
            message: "Identity traits carry textual values only.",
          });
        }
      }
      if (field.permittedValueRange !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permittedValueRange"],
          message: "Identity traits must not carry numeric bounds.",
        });
      }
    }
  });
export type SourceResolvedField = z.infer<typeof SourceResolvedFieldSchema>;

/**
 * Override proposals as the model may emit them: targets are human labels,
 * never canonical keys. Proposals are validated and re-keyed by deterministic
 * code before they become ExplicitSheetOverrides.
 */
export const ProposedSheetOverrideSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add"),
    label: AuthoredFieldLabelSchema,
    category: FieldCategorySchema.optional(),
    initialValue: z
      .union([
        z.number().finite(),
        z.string().max(MAX_OVERRIDE_STRING_VALUE_CHARS),
      ])
      .nullable()
      .optional(),
    permittedValueRange: NumericValueRangeSchema.optional(),
  }),
  z.strictObject({
    op: z.literal("remove"),
    targetLabel: AuthoredFieldLabelSchema,
    category: FieldCategorySchema.optional(),
  }),
  z
    .strictObject({
      op: z.literal("rename"),
      sourceLabel: AuthoredFieldLabelSchema,
      newLabel: AuthoredFieldLabelSchema,
      category: FieldCategorySchema.optional(),
    })
    .superRefine((body, context) => {
      if (body.sourceLabel === body.newLabel) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newLabel"],
          message: "A renamed field must use a different label.",
        });
      }
    }),
  z
    .strictObject({
      op: z.literal("replace"),
      sourceLabel: AuthoredFieldLabelSchema,
      replacementLabel: AuthoredFieldLabelSchema,
      category: FieldCategorySchema.optional(),
    })
    .superRefine((body, context) => {
      if (body.sourceLabel === body.replacementLabel) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["replacementLabel"],
          message: "A replaced field must use a different label.",
        });
      }
    }),
  z
    .strictObject({
      op: z.literal("constrain"),
      targetLabel: AuthoredFieldLabelSchema,
      category: FieldCategorySchema.optional(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
    })
    .superRefine((body, context) => {
      if (body.min === undefined && body.max === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: "A constrain operation requires at least one bound.",
        });
      } else if (
        body.min !== undefined &&
        body.max !== undefined &&
        body.min > body.max
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "A constrain max must be greater than or equal to min.",
        });
      }
    }),
  z.strictObject({
    op: z.literal("set_value"),
    targetLabel: AuthoredFieldLabelSchema,
    category: FieldCategorySchema.optional(),
    value: z
      .union([
        z.number().finite(),
        z.string().max(MAX_OVERRIDE_STRING_VALUE_CHARS),
      ])
      .nullable(),
  }),
]);
export type ProposedSheetOverride = z.infer<typeof ProposedSheetOverrideSchema>;

/**
 * A validated, applied override. Targets are canonical keys, not labels, and
 * the ADD op carries the fully resolved field so the normalized definition is
 * self-contained after deterministic application.
 */
export const ExplicitSheetOverrideSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add"),
    field: SourceResolvedFieldSchema,
  }),
  z.strictObject({
    op: z.literal("remove"),
    targetKey: CanonicalFieldKeySchema,
  }),
  z.strictObject({
    op: z.literal("rename"),
    sourceKey: CanonicalFieldKeySchema,
    newLabel: AuthoredFieldLabelSchema,
  }),
  z.strictObject({
    op: z.literal("replace"),
    sourceKey: CanonicalFieldKeySchema,
    replacementLabel: AuthoredFieldLabelSchema,
  }),
  z
    .strictObject({
      op: z.literal("constrain"),
      targetKey: CanonicalFieldKeySchema,
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
    })
    .superRefine((body, context) => {
      if (body.min === undefined && body.max === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: "A constrain operation requires at least one bound.",
        });
      } else if (
        body.min !== undefined &&
        body.max !== undefined &&
        body.min > body.max
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "A constrain max must be greater than or equal to min.",
        });
      }
    }),
  z.strictObject({
    op: z.literal("set_value"),
    targetKey: CanonicalFieldKeySchema,
    value: z
      .union([
        z.number().finite(),
        z.string().max(MAX_OVERRIDE_STRING_VALUE_CHARS),
      ])
      .nullable(),
  }),
]);
export type ExplicitSheetOverride = z.infer<typeof ExplicitSheetOverrideSchema>;

export const GENERATION_CONFLICT_CODES = [
  "AMBIGUOUS_OVERRIDE_TARGET",
  "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT",
  "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
  "INVALID_CONSTRAINT_VALUE",
  "UNRESOLVED_SOURCE_COLLISION",
  "INVALID_INSTRUCTION_CONTEXT",
  "INVALID_OVERRIDE_CONSTRAINTS",
  "MISSING_OVERRIDE_TARGET",
  "AMBIGUOUS_DERIVATION_CATEGORY",
  "INVALID_DERIVATION_FIELD",
  "NPC_MECHANICAL_VALUE_FORBIDDEN",
  "FABRICATED_RULE_EVIDENCE",
  "FOREIGN_CITATION_EVIDENCE",
  "DUPLICATE_TEMPLATE_FIELD_LABEL",
  "TEMPLATE_MODE_MISMATCH",
  "TEMPLATE_CATEGORY_DISAGREEMENT",
  "TEMPLATE_BOUND_DISAGREEMENT",
] as const;

export const GenerationConflictCodeSchema = z.enum(GENERATION_CONFLICT_CODES);
export type GenerationConflictCode = (typeof GENERATION_CONFLICT_CODES)[number];

export const GenerationConflictSchema = z.strictObject({
  code: GenerationConflictCodeSchema,
  canonicalKey: CanonicalFieldKeySchema.nullable(),
  message: z.string().min(1).max(2_000).regex(/\S/),
  sourceLabels: z
    .array(AuthoredFieldLabelSchema)
    .max(MAX_CONFLICT_SOURCE_LABELS)
    .default([]),
});
export type GenerationConflict = z.infer<typeof GenerationConflictSchema>;

export const NPCAuthoringDefinitionSchema = z.strictObject({
  disposition: NPCDispositionSchema,
  threat: NPCThreatLevelSchema.nullable(),
});
export type NPCAuthoringDefinition = z.infer<
  typeof NPCAuthoringDefinitionSchema
>;

/**
 * Logical section grouping carried by a normalized definition. Template-backed
 * definitions fill it from the extracted sheet template so final construction
 * can preserve the source sheet's grouping instead of always collapsing to the
 * built-in identity/attributes fallbacks. Non-template definitions leave it
 * empty and Level-3 falls back to exactly today's behavior.
 */
export const SheetSectionDescriptorSchema = z.strictObject({
  key: SymbolicKeySchema,
  title: z.string().min(1).max(200).regex(/\S/),
  purpose: z.string().min(1).max(1_000).regex(/\S/).optional(),
});
export type SheetSectionDescriptor = z.infer<
  typeof SheetSectionDescriptorSchema
>;

const definitionSectionsSchema = z
  .array(SheetSectionDescriptorSchema)
  .max(MAX_PLAN_SECTIONS)
  .default([])
  .superRefine((sections, context) => {
    const seen = new Set<string>();
    sections.forEach((section, index) => {
      if (seen.has(section.key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(index), "key"],
          message: `Section key "${section.key}" repeats in the normalized definition.`,
        });
      }
      seen.add(section.key);
    });
  });

/**
 * Private intermediate contract between source resolution and the section
 * planner. Fields, overrides and conflicts are explicit so later stages never
 * re-derive authority silently. Identity and mechanical namespaces coexist by
 * canonicalKey + category; duplicate detection happens at merge time.
 */
export const NormalizedSheetDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    mode: CharacterSheetAuthoringModeSchema,
    characterName: CharacterNameSchema.default(null),
    fields: z
      .array(SourceResolvedFieldSchema)
      .max(MAX_TOTAL_FIELDS)
      .default([]),
    sections: definitionSectionsSchema,
    overrides: z
      .array(ExplicitSheetOverrideSchema)
      .max(MAX_EXPLICIT_INPUT_OVERRIDES)
      .default([]),
    conflicts: z
      .array(GenerationConflictSchema)
      .max(MAX_GENERATION_CONFLICTS)
      .default([]),
    npc: NPCAuthoringDefinitionSchema.optional(),
  })
  .superRefine((definition, context) => {
    if (definition.mode === "npc" && definition.npc === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["npc"],
        message: "An NPC sheet definition requires an npc block.",
      });
    }
    if (definition.mode === "pc" && definition.npc !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["npc"],
        message: "A player sheet definition must not carry an npc block.",
      });
    }
  });
export type NormalizedSheetDefinition = z.infer<
  typeof NormalizedSheetDefinitionSchema
>;
