import { z } from "zod";

export const RULES_CONTEXT_VERSION = "1" as const;

const MAX_RULE_SOURCES = 32;
const MAX_NORMALIZED_RULES = 512;
const MAX_RULE_OVERRIDES = 128;
const MAX_RULE_CONFLICTS = 128;
const MAX_CITATIONS_PER_RULE = 64;
const MAX_DIAGNOSTIC_PATH_SEGMENTS = 32;
const MAX_JSON_VALUE_DEPTH = 8;
const MAX_JSON_ARRAY_ITEMS = 128;
const MAX_JSON_OBJECT_PROPERTIES = 128;
const MAX_JSON_STRING_LENGTH = 10_000;
const MAX_DOMAIN_ISSUES = 256;

const identifierPattern =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(identifierPattern, "Identifiers must use a safe opaque format.");

const shortTextSchema = z.string().min(1).max(256).regex(/\S/);
const summarySchema = z.string().min(1).max(2_000).regex(/\S/);

/**
 * Additive exports for provider-edge validation. Provider ports may validate
 * model output against these bounded schemas before constructing a RulesContext.
 */
export const RuleIdentifierSchema = identifierSchema;
export type RuleIdentifier = z.infer<typeof RuleIdentifierSchema>;
export const RuleShortTextSchema = shortTextSchema;
export const RuleSummarySchema = summarySchema;

// Private recursive typing aid for schema construction; JsonValue is inferred below.
type BoundedJsonValue =
  | string
  | number
  | boolean
  | null
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

const JsonPrimitiveSchema = z.union([
  z.string().max(MAX_JSON_STRING_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const JsonObjectKeySchema = z.string().min(1).max(128);

function createJsonValueSchema(
  remainingDepth: number,
): z.ZodType<BoundedJsonValue> {
  if (remainingDepth === 0) {
    return JsonPrimitiveSchema;
  }

  const nestedValueSchema = createJsonValueSchema(remainingDepth - 1);
  return z.union([
    JsonPrimitiveSchema,
    z.array(nestedValueSchema).max(MAX_JSON_ARRAY_ITEMS),
    z
      .record(JsonObjectKeySchema, nestedValueSchema)
      .superRefine((value, context) => {
        if (Object.keys(value).length > MAX_JSON_OBJECT_PROPERTIES) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `JSON objects may contain at most ${MAX_JSON_OBJECT_PROPERTIES} properties.`,
          });
        }
      }),
  ]);
}

/** A bounded JSON-compatible value safe to serialize, persist, or send to a provider. */
export const JsonValueSchema = createJsonValueSchema(MAX_JSON_VALUE_DEPTH);
export type JsonValue = z.infer<typeof JsonValueSchema>;

export const RulesContextIdSchema = identifierSchema;
export type RulesContextId = z.infer<typeof RulesContextIdSchema>;

export const RuleSourceIdSchema = identifierSchema;
export type RuleSourceId = z.infer<typeof RuleSourceIdSchema>;

export const NormalizedRuleIdSchema = identifierSchema;
export type NormalizedRuleId = z.infer<typeof NormalizedRuleIdSchema>;

export const RuleOverrideIdSchema = identifierSchema;
export type RuleOverrideId = z.infer<typeof RuleOverrideIdSchema>;

export const RuleConflictIdSchema = identifierSchema;
export type RuleConflictId = z.infer<typeof RuleConflictIdSchema>;

export const PresetRuleSourceSchema = z.strictObject({
  id: RuleSourceIdSchema,
  type: z.literal("preset"),
  systemKey: identifierSchema,
  editionKey: identifierSchema,
  displayName: shortTextSchema,
});
export type PresetRuleSource = z.infer<typeof PresetRuleSourceSchema>;

export const UploadedRulebookSourceSchema = z.strictObject({
  id: RuleSourceIdSchema,
  type: z.literal("uploaded-rulebook"),
  filename: z.string().min(1).max(255).regex(/\S/),
  fileSize: z.number().int().positive().max(100_000_000),
  pageCount: z.number().int().positive().max(10_000).nullable(),
  sha256: z.string().regex(sha256Pattern, "sha256 must be lowercase hex."),
  temporary: z.literal(true),
});
export type UploadedRulebookSource = z.infer<
  typeof UploadedRulebookSourceSchema
>;

export const ChatRuleSourceSchema = z.strictObject({
  id: RuleSourceIdSchema,
  type: z.literal("chat"),
  label: shortTextSchema,
});
export type ChatRuleSource = z.infer<typeof ChatRuleSourceSchema>;

/** Sources are intentionally metadata-only; raw documents and embeddings remain outside the domain contract. */
export const RuleSourceSchema = z.discriminatedUnion("type", [
  PresetRuleSourceSchema,
  UploadedRulebookSourceSchema,
  ChatRuleSourceSchema,
]);
export type RuleSource = z.infer<typeof RuleSourceSchema>;

/** A citation may explicitly omit page information when a source has no dependable page boundary. */
export const RuleCitationSchema = z
  .strictObject({
    sourceId: RuleSourceIdSchema,
    pageStart: z.number().int().positive().nullable(),
    pageEnd: z.number().int().positive().nullable(),
    section: z.string().min(1).max(500).regex(/\S/).nullable(),
    chunkId: identifierSchema.nullable(),
  })
  .superRefine((citation, context) => {
    if (citation.pageEnd !== null && citation.pageStart === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageEnd"],
        message: "A citation pageEnd requires pageStart.",
      });
    }

    if (
      citation.pageStart !== null &&
      citation.pageEnd !== null &&
      citation.pageEnd < citation.pageStart
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageEnd"],
        message: "Citation pageEnd must not precede pageStart.",
      });
    }
  });
export type RuleCitation = z.infer<typeof RuleCitationSchema>;

export const CharacterIntentSchema = z.strictObject({
  summary: summarySchema,
});
export type CharacterIntent = z.infer<typeof CharacterIntentSchema>;

/** A user-authored rule change is distinct from the non-authoritative character intent. */
export const RuleOverrideSchema = z.strictObject({
  id: RuleOverrideIdSchema,
  key: identifierSchema,
  summary: summarySchema,
  sourceId: RuleSourceIdSchema,
  structuredValue: JsonValueSchema.optional(),
});
export type RuleOverride = z.infer<typeof RuleOverrideSchema>;

export const NormalizedRuleSchema = z.strictObject({
  id: NormalizedRuleIdSchema,
  category: identifierSchema,
  key: identifierSchema,
  summary: summarySchema,
  structuredValue: JsonValueSchema.optional(),
  citations: z.array(RuleCitationSchema).min(1).max(MAX_CITATIONS_PER_RULE),
  confidence: z.number().min(0).max(1),
});
export type NormalizedRule = z.infer<typeof NormalizedRuleSchema>;

export const RuleConflictResolutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rule"),
    ruleId: NormalizedRuleIdSchema,
  }),
  z.strictObject({
    kind: z.literal("source"),
    sourceId: RuleSourceIdSchema,
  }),
  z.strictObject({
    kind: z.literal("user"),
    description: summarySchema,
  }),
]);
export type RuleConflictResolution = z.infer<
  typeof RuleConflictResolutionSchema
>;

/** Conflicts remain explicit until a user-provided resolution is recorded. */
export const RuleConflictSchema = z.strictObject({
  id: RuleConflictIdSchema,
  category: identifierSchema,
  key: identifierSchema,
  description: summarySchema,
  competingRuleIds: z.array(NormalizedRuleIdSchema).max(32),
  competingSourceIds: z.array(RuleSourceIdSchema).max(32),
  status: z.enum(["unresolved", "resolved"]),
  resolution: RuleConflictResolutionSchema.nullable(),
});
export type RuleConflict = z.infer<typeof RuleConflictSchema>;

export const RulesContextStatusSchema = z.enum([
  "building",
  "conflicts",
  "awaiting-confirmation",
  "ready",
]);
export type RulesContextStatus = z.infer<typeof RulesContextStatusSchema>;

/**
 * Canonical serializable rules-analysis result. Parse structurally first, then
 * call validateRulesContextDomain() for graph and workflow invariants.
 */
export const RulesContextSchema = z.strictObject({
  schemaVersion: z.literal(RULES_CONTEXT_VERSION),
  analysisId: RulesContextIdSchema,
  sources: z.array(RuleSourceSchema).min(1).max(MAX_RULE_SOURCES),
  authorityOrder: z.array(RuleSourceIdSchema).min(1).max(MAX_RULE_SOURCES),
  characterIntent: CharacterIntentSchema.nullable(),
  ruleOverrides: z.array(RuleOverrideSchema).max(MAX_RULE_OVERRIDES),
  normalizedRules: z.array(NormalizedRuleSchema).max(MAX_NORMALIZED_RULES),
  conflicts: z.array(RuleConflictSchema).max(MAX_RULE_CONFLICTS),
  status: RulesContextStatusSchema,
});
export type RulesContext = z.infer<typeof RulesContextSchema>;

export const RulesContextDomainIssueCodeSchema = z.enum([
  "DUPLICATE_SOURCE_ID",
  "DUPLICATE_AUTHORITY_SOURCE",
  "UNKNOWN_AUTHORITY_SOURCE",
  "MISSING_AUTHORITY_SOURCE",
  "DUPLICATE_RULE_OVERRIDE_ID",
  "UNKNOWN_RULE_OVERRIDE_SOURCE",
  "DUPLICATE_RULE_ID",
  "UNKNOWN_CITATION_SOURCE",
  "INVALID_CITATION_PAGE_RANGE",
  "CITATION_PAGE_OUT_OF_RANGE",
  "DUPLICATE_CONFLICT_ID",
  "DUPLICATE_CONFLICT_RULE_REFERENCE",
  "DUPLICATE_CONFLICT_SOURCE_REFERENCE",
  "CONFLICT_WITHOUT_COMPETITOR",
  "UNKNOWN_CONFLICT_RULE",
  "UNKNOWN_CONFLICT_SOURCE",
  "MISSING_CONFLICT_RESOLUTION",
  "UNEXPECTED_CONFLICT_RESOLUTION",
  "UNKNOWN_RESOLUTION_RULE",
  "UNKNOWN_RESOLUTION_SOURCE",
  "RESOLUTION_RULE_NOT_COMPETING",
  "RESOLUTION_SOURCE_NOT_COMPETING",
  "UNRESOLVED_CONFLICT_WHILE_READY",
  "UNRESOLVED_CONFLICT_OUTSIDE_CONFLICTS_STATUS",
  "CONFLICTS_STATUS_WITHOUT_UNRESOLVED",
  "AWAITING_CONFIRMATION_WITHOUT_RESOLVED_CONFLICT",
]);
export type RulesContextDomainIssueCode = z.infer<
  typeof RulesContextDomainIssueCodeSchema
>;

export const RulesContextDomainIssueSchema = z.strictObject({
  code: RulesContextDomainIssueCodeSchema,
  path: z
    .array(z.union([z.string(), z.number().int().nonnegative()]))
    .max(MAX_DIAGNOSTIC_PATH_SEGMENTS),
  message: z.string().min(1).max(500),
});
export type RulesContextDomainIssue = z.infer<
  typeof RulesContextDomainIssueSchema
>;

export const RulesContextDomainValidationResultSchema = z.discriminatedUnion(
  "valid",
  [
    z.strictObject({
      valid: z.literal(true),
      issues: z.tuple([]),
    }),
    z.strictObject({
      valid: z.literal(false),
      issues: z.array(RulesContextDomainIssueSchema).min(1),
    }),
  ],
);
export type RulesContextDomainValidationResult = z.infer<
  typeof RulesContextDomainValidationResultSchema
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
  issues: RulesContextDomainIssue[],
  code: RulesContextDomainIssueCode,
  path: RulesContextDomainIssue["path"],
  message: string,
): void {
  if (issues.length < MAX_DOMAIN_ISSUES) {
    issues.push({ code, path, message });
  }
}

function validateCitation(
  citation: RuleCitation,
  path: RulesContextDomainIssue["path"],
  sourceById: ReadonlyMap<string, RuleSource>,
  issues: RulesContextDomainIssue[],
): void {
  const source = sourceById.get(citation.sourceId);

  if (source === undefined) {
    addIssue(
      issues,
      "UNKNOWN_CITATION_SOURCE",
      [...path, "sourceId"],
      `Citation references unknown source "${citation.sourceId}".`,
    );
  }

  if (citation.pageEnd !== null && citation.pageStart === null) {
    addIssue(
      issues,
      "INVALID_CITATION_PAGE_RANGE",
      [...path, "pageEnd"],
      "A citation pageEnd requires pageStart.",
    );
  }

  if (
    citation.pageStart !== null &&
    citation.pageEnd !== null &&
    citation.pageEnd < citation.pageStart
  ) {
    addIssue(
      issues,
      "INVALID_CITATION_PAGE_RANGE",
      path,
      "Citation pageEnd must not precede pageStart.",
    );
  }

  if (source?.type === "uploaded-rulebook" && source.pageCount !== null) {
    const lastReferencedPage = citation.pageEnd ?? citation.pageStart;
    if (lastReferencedPage !== null && lastReferencedPage > source.pageCount) {
      addIssue(
        issues,
        "CITATION_PAGE_OUT_OF_RANGE",
        path,
        `Citation page ${lastReferencedPage} exceeds source page count ${source.pageCount}.`,
      );
    }
  }
}

/**
 * Validates RulesContext graph integrity and conflict workflow after a
 * successful RulesContextSchema parse. It never resolves a conflict itself.
 */
export function validateRulesContextDomain(
  context: RulesContext,
): RulesContextDomainValidationResult {
  const issues: RulesContextDomainIssue[] = [];
  const sourceIds = context.sources.map((source) => source.id);
  const sourceById = new Map(
    context.sources.map((source) => [source.id, source]),
  );
  const sourceIdSet = new Set(sourceIds);

  for (const sourceId of findDuplicates(sourceIds)) {
    addIssue(
      issues,
      "DUPLICATE_SOURCE_ID",
      ["sources"],
      `Source id "${sourceId}" appears more than once.`,
    );
  }

  for (const sourceId of findDuplicates(context.authorityOrder)) {
    addIssue(
      issues,
      "DUPLICATE_AUTHORITY_SOURCE",
      ["authorityOrder"],
      `Authority order repeats source "${sourceId}".`,
    );
  }

  const authoritySourceIds = new Set(context.authorityOrder);
  for (const sourceId of context.authorityOrder) {
    if (!sourceIdSet.has(sourceId)) {
      addIssue(
        issues,
        "UNKNOWN_AUTHORITY_SOURCE",
        ["authorityOrder"],
        `Authority order references unknown source "${sourceId}".`,
      );
    }
  }

  for (const sourceId of sourceIdSet) {
    if (!authoritySourceIds.has(sourceId)) {
      addIssue(
        issues,
        "MISSING_AUTHORITY_SOURCE",
        ["authorityOrder"],
        `Active source "${sourceId}" is missing from authority order.`,
      );
    }
  }

  const overrideIds = context.ruleOverrides.map((override) => override.id);
  for (const overrideId of findDuplicates(overrideIds)) {
    addIssue(
      issues,
      "DUPLICATE_RULE_OVERRIDE_ID",
      ["ruleOverrides"],
      `Rule override id "${overrideId}" appears more than once.`,
    );
  }

  for (const [overrideIndex, override] of context.ruleOverrides.entries()) {
    if (!sourceIdSet.has(override.sourceId)) {
      addIssue(
        issues,
        "UNKNOWN_RULE_OVERRIDE_SOURCE",
        ["ruleOverrides", overrideIndex, "sourceId"],
        `Rule override references unknown source "${override.sourceId}".`,
      );
    }
  }

  const normalizedRuleIds = context.normalizedRules.map((rule) => rule.id);
  const normalizedRuleIdSet = new Set(normalizedRuleIds);
  for (const ruleId of findDuplicates(normalizedRuleIds)) {
    addIssue(
      issues,
      "DUPLICATE_RULE_ID",
      ["normalizedRules"],
      `Normalized rule id "${ruleId}" appears more than once.`,
    );
  }

  for (const [ruleIndex, rule] of context.normalizedRules.entries()) {
    for (const [citationIndex, citation] of rule.citations.entries()) {
      validateCitation(
        citation,
        ["normalizedRules", ruleIndex, "citations", citationIndex],
        sourceById,
        issues,
      );
    }
  }

  const conflictIds = context.conflicts.map((conflict) => conflict.id);
  for (const conflictId of findDuplicates(conflictIds)) {
    addIssue(
      issues,
      "DUPLICATE_CONFLICT_ID",
      ["conflicts"],
      `Conflict id "${conflictId}" appears more than once.`,
    );
  }

  for (const [conflictIndex, conflict] of context.conflicts.entries()) {
    for (const ruleId of findDuplicates(conflict.competingRuleIds)) {
      addIssue(
        issues,
        "DUPLICATE_CONFLICT_RULE_REFERENCE",
        ["conflicts", conflictIndex, "competingRuleIds"],
        `Conflict repeats normalized rule "${ruleId}".`,
      );
    }

    for (const sourceId of findDuplicates(conflict.competingSourceIds)) {
      addIssue(
        issues,
        "DUPLICATE_CONFLICT_SOURCE_REFERENCE",
        ["conflicts", conflictIndex, "competingSourceIds"],
        `Conflict repeats source "${sourceId}".`,
      );
    }

    if (
      conflict.competingRuleIds.length === 0 &&
      conflict.competingSourceIds.length === 0
    ) {
      addIssue(
        issues,
        "CONFLICT_WITHOUT_COMPETITOR",
        ["conflicts", conflictIndex],
        "A conflict must identify at least one competing rule or source.",
      );
    }

    for (const ruleId of conflict.competingRuleIds) {
      if (!normalizedRuleIdSet.has(ruleId)) {
        addIssue(
          issues,
          "UNKNOWN_CONFLICT_RULE",
          ["conflicts", conflictIndex, "competingRuleIds"],
          `Conflict references unknown normalized rule "${ruleId}".`,
        );
      }
    }

    for (const sourceId of conflict.competingSourceIds) {
      if (!sourceIdSet.has(sourceId)) {
        addIssue(
          issues,
          "UNKNOWN_CONFLICT_SOURCE",
          ["conflicts", conflictIndex, "competingSourceIds"],
          `Conflict references unknown source "${sourceId}".`,
        );
      }
    }

    if (conflict.status === "unresolved" && conflict.resolution !== null) {
      addIssue(
        issues,
        "UNEXPECTED_CONFLICT_RESOLUTION",
        ["conflicts", conflictIndex, "resolution"],
        "An unresolved conflict must not include a resolution.",
      );
    }

    if (conflict.status === "resolved" && conflict.resolution === null) {
      addIssue(
        issues,
        "MISSING_CONFLICT_RESOLUTION",
        ["conflicts", conflictIndex, "resolution"],
        "A resolved conflict must include a user-recorded resolution.",
      );
    }

    if (conflict.resolution?.kind === "rule") {
      if (!normalizedRuleIdSet.has(conflict.resolution.ruleId)) {
        addIssue(
          issues,
          "UNKNOWN_RESOLUTION_RULE",
          ["conflicts", conflictIndex, "resolution", "ruleId"],
          `Conflict resolution references unknown rule "${conflict.resolution.ruleId}".`,
        );
      } else if (
        !conflict.competingRuleIds.includes(conflict.resolution.ruleId)
      ) {
        addIssue(
          issues,
          "RESOLUTION_RULE_NOT_COMPETING",
          ["conflicts", conflictIndex, "resolution", "ruleId"],
          "A selected rule must be one of the conflict's competing rules.",
        );
      }
    }

    if (conflict.resolution?.kind === "source") {
      if (!sourceIdSet.has(conflict.resolution.sourceId)) {
        addIssue(
          issues,
          "UNKNOWN_RESOLUTION_SOURCE",
          ["conflicts", conflictIndex, "resolution", "sourceId"],
          `Conflict resolution references unknown source "${conflict.resolution.sourceId}".`,
        );
      } else if (
        !conflict.competingSourceIds.includes(conflict.resolution.sourceId)
      ) {
        addIssue(
          issues,
          "RESOLUTION_SOURCE_NOT_COMPETING",
          ["conflicts", conflictIndex, "resolution", "sourceId"],
          "A selected source must be one of the conflict's competing sources.",
        );
      }
    }
  }

  const unresolvedConflicts = context.conflicts.filter(
    (conflict) => conflict.status === "unresolved",
  );
  const resolvedConflicts = context.conflicts.filter(
    (conflict) => conflict.status === "resolved",
  );

  if (unresolvedConflicts.length > 0) {
    if (context.status === "ready") {
      addIssue(
        issues,
        "UNRESOLVED_CONFLICT_WHILE_READY",
        ["status"],
        "A ready RulesContext must not contain unresolved conflicts.",
      );
    } else if (context.status !== "conflicts") {
      addIssue(
        issues,
        "UNRESOLVED_CONFLICT_OUTSIDE_CONFLICTS_STATUS",
        ["status"],
        'Unresolved conflicts require RulesContext status "conflicts".',
      );
    }
  } else if (context.status === "conflicts") {
    addIssue(
      issues,
      "CONFLICTS_STATUS_WITHOUT_UNRESOLVED",
      ["status"],
      'RulesContext status "conflicts" requires at least one unresolved conflict.',
    );
  }

  if (
    context.status === "awaiting-confirmation" &&
    resolvedConflicts.length === 0
  ) {
    addIssue(
      issues,
      "AWAITING_CONFIRMATION_WITHOUT_RESOLVED_CONFLICT",
      ["status"],
      "Awaiting confirmation requires at least one resolved conflict.",
    );
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

/** Generates JSON Schema directly from the canonical Zod 4 schema. */
export function getRulesContextJsonSchema() {
  return z.toJSONSchema(RulesContextSchema, { reused: "ref" });
}
