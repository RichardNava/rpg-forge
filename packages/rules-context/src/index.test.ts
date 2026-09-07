import { describe, expect, it } from "vitest";

import {
  RuleConflictSchema,
  RulesContextSchema,
  getRulesContextJsonSchema,
  validateRulesContextDomain,
} from "./index";

function createRulesContext() {
  return RulesContextSchema.parse({
    schemaVersion: "1",
    analysisId: "analysis-1",
    sources: [
      {
        id: "preset-1",
        type: "preset",
        systemKey: "generic-fantasy",
        editionKey: "core",
        displayName: "Generic Fantasy Core",
      },
    ],
    authorityOrder: ["preset-1"],
    characterIntent: {
      summary: "Create a veteran wilderness explorer.",
    },
    ruleOverrides: [
      {
        id: "override-critical-range",
        key: "critical-range",
        summary: "Critical success occurs on 19 or 20.",
        sourceId: "preset-1",
        structuredValue: { minimum: 19, maximum: 20 },
      },
    ],
    normalizedRules: [
      {
        id: "rule-initiative-order",
        category: "combat",
        key: "initiative-order",
        summary: "Participants act from highest initiative to lowest.",
        structuredValue: { order: "descending" },
        citations: [
          {
            sourceId: "preset-1",
            pageStart: null,
            pageEnd: null,
            section: "Combat",
            chunkId: "preset-combat-1",
          },
        ],
        confidence: 0.9,
      },
    ],
    conflicts: [],
    status: "ready",
  });
}

function issueCodes(value: ReturnType<typeof validateRulesContextDomain>) {
  return value.issues.map((issue) => issue.code);
}

function createNestedJsonArray(depth: number): unknown {
  let value: unknown = "value";
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
}

describe("RulesContextSchema", () => {
  it("accepts a valid minimal RulesContext", () => {
    const context = createRulesContext();

    expect(validateRulesContextDomain(context)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("supports preset, uploaded rulebook, and chat sources", () => {
    const context = createRulesContext();
    const value = RulesContextSchema.parse({
      ...context,
      sources: [
        ...context.sources,
        {
          id: "rulebook-1",
          type: "uploaded-rulebook",
          filename: "local-rules.pdf",
          fileSize: 8_192,
          pageCount: 12,
          sha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          temporary: true,
        },
        {
          id: "chat-1",
          type: "chat",
          label: "Session zero agreement",
        },
      ],
      authorityOrder: ["chat-1", "rulebook-1", "preset-1"],
    });

    expect(validateRulesContextDomain(value)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("requires rulebook source metadata to remain temporary", () => {
    const context = createRulesContext();

    expect(
      RulesContextSchema.safeParse({
        ...context,
        sources: [
          {
            id: "rulebook-1",
            type: "uploaded-rulebook",
            filename: "local-rules.pdf",
            fileSize: 8_192,
            pageCount: 12,
            sha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            temporary: false,
          },
        ],
        authorityOrder: ["rulebook-1"],
      }).success,
    ).toBe(false);
  });

  it("reports duplicate source IDs", () => {
    const context = createRulesContext();
    const result = validateRulesContextDomain({
      ...context,
      sources: [...context.sources, context.sources[0]!],
      authorityOrder: ["preset-1", "preset-1"],
    });

    expect(issueCodes(result)).toContain("DUPLICATE_SOURCE_ID");
  });

  it("reports unknown, duplicate, and missing authority sources", () => {
    const context = createRulesContext();
    const result = validateRulesContextDomain({
      ...context,
      authorityOrder: ["missing-source", "missing-source"],
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_AUTHORITY_SOURCE",
        "DUPLICATE_AUTHORITY_SOURCE",
        "MISSING_AUTHORITY_SOURCE",
      ]),
    );
  });

  it("accepts an explicitly incomplete page citation", () => {
    const context = createRulesContext();

    expect(
      validateRulesContextDomain({
        ...context,
        normalizedRules: [
          {
            ...context.normalizedRules[0]!,
            citations: [
              {
                sourceId: "preset-1",
                pageStart: null,
                pageEnd: null,
                section: null,
                chunkId: null,
              },
            ],
          },
        ],
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("reports invalid citation page ranges", () => {
    const context = createRulesContext();
    const result = validateRulesContextDomain({
      ...context,
      normalizedRules: [
        {
          ...context.normalizedRules[0]!,
          citations: [
            {
              sourceId: "preset-1",
              pageStart: 9,
              pageEnd: 4,
              section: null,
              chunkId: null,
            },
          ],
        },
      ],
    });

    expect(issueCodes(result)).toContain("INVALID_CITATION_PAGE_RANGE");
  });

  it("rejects malformed citation ranges structurally", () => {
    const context = createRulesContext();

    expect(
      RulesContextSchema.safeParse({
        ...context,
        normalizedRules: [
          {
            ...context.normalizedRules[0]!,
            citations: [
              {
                sourceId: "preset-1",
                pageStart: null,
                pageEnd: 4,
                section: null,
                chunkId: null,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("bounds structured JSON values without recursive overflow", () => {
    const context = createRulesContext();
    const deeplyNestedValue = createNestedJsonArray(2_000);
    const parseDeepValue = () =>
      RulesContextSchema.safeParse({
        ...context,
        ruleOverrides: [
          {
            ...context.ruleOverrides[0]!,
            structuredValue: deeplyNestedValue,
          },
        ],
      });

    expect(parseDeepValue).not.toThrow();
    expect(parseDeepValue().success).toBe(false);

    const oversizedObject = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`value-${index}`, index]),
    );
    expect(
      RulesContextSchema.safeParse({
        ...context,
        ruleOverrides: [
          {
            ...context.ruleOverrides[0]!,
            structuredValue: oversizedObject,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a normalized rule without provenance citations structurally", () => {
    const context = createRulesContext();

    expect(
      RulesContextSchema.safeParse({
        ...context,
        normalizedRules: [{ ...context.normalizedRules[0], citations: [] }],
      }).success,
    ).toBe(false);
  });

  it("reports conflicts that reference missing normalized rules", () => {
    const context = createRulesContext();
    const result = validateRulesContextDomain({
      ...context,
      conflicts: [
        {
          id: "conflict-1",
          category: "combat",
          key: "initiative-order",
          description: "Two sources disagree about initiative order.",
          competingRuleIds: ["missing-rule"],
          competingSourceIds: [],
          status: "unresolved",
          resolution: null,
        },
      ],
      status: "conflicts",
    });

    expect(issueCodes(result)).toContain("UNKNOWN_CONFLICT_RULE");
  });

  it("rejects unresolved conflicts while ready", () => {
    const context = createRulesContext();
    const result = validateRulesContextDomain({
      ...context,
      conflicts: [
        {
          id: "conflict-1",
          category: "combat",
          key: "initiative-order",
          description: "Two sources disagree about initiative order.",
          competingRuleIds: ["rule-initiative-order"],
          competingSourceIds: [],
          status: "unresolved",
          resolution: null,
        },
      ],
    });

    expect(issueCodes(result)).toContain("UNRESOLVED_CONFLICT_WHILE_READY");
  });

  it("accepts a resolved conflict awaiting user confirmation", () => {
    const context = createRulesContext();
    const value = {
      ...context,
      conflicts: [
        {
          id: "conflict-1",
          category: "combat",
          key: "initiative-order",
          description: "Two sources disagree about initiative order.",
          competingRuleIds: ["rule-initiative-order"],
          competingSourceIds: [],
          status: "resolved" as const,
          resolution: {
            kind: "rule" as const,
            ruleId: "rule-initiative-order",
          },
        },
      ],
      status: "awaiting-confirmation" as const,
    };

    expect(validateRulesContextDomain(value)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("keeps character intent separate from authority-bearing rule overrides", () => {
    const context = createRulesContext();

    expect(context.characterIntent?.summary).toContain("wilderness");
    expect(context.ruleOverrides[0]?.key).toBe("critical-range");
    expect(
      RuleConflictSchema.safeParse({
        id: "invalid-conflict",
        category: "combat",
        key: "critical-range",
        description: "Invalid extra property test.",
        competingRuleIds: [],
        competingSourceIds: ["preset-1"],
        status: "unresolved",
        resolution: null,
        characterIntent: context.characterIntent,
      }).success,
    ).toBe(false);
  });

  it("rejects undeclared root properties", () => {
    const context = createRulesContext();

    expect(
      RulesContextSchema.safeParse({ ...context, injected: true }).success,
    ).toBe(false);
  });

  it("generates JSON Schema from the canonical Zod schema", () => {
    const jsonSchema = getRulesContextJsonSchema();

    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        schemaVersion: expect.any(Object),
        sources: expect.any(Object),
      }),
    });
  });
});
