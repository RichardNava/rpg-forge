import { describe, expect, it } from "vitest";
import {
  resolveSources,
  SourceResolutionResultSchema,
} from "./source-merge.js";
import {
  canonicalizeFieldLabel,
  SourceResolvedFieldSchema,
  type SourceResolvedField,
} from "./source-resolution.js";

const rulebookRange = { min: 3, max: 18 };

const rulebookCitations = [
  {
    sourceId: "src-1",
    pageStart: 10,
    pageEnd: 12,
    section: "Chapter 3",
    chunkId: null,
  },
  {
    sourceId: "src-2",
    pageStart: 4,
    pageEnd: 4,
    section: "Intro",
    chunkId: "chunk-2",
  },
];

function guiMechanical(
  label: string,
  explicitValue?: number | null,
): SourceResolvedField {
  return SourceResolvedFieldSchema.parse({
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    explicitValue: explicitValue ?? null,
    provenance: { origins: ["gui"] },
  });
}

function guiMechanicalWithRange(
  label: string,
  range: { min: number; max: number },
): SourceResolvedField {
  return SourceResolvedFieldSchema.parse({
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    permittedValueRange: range,
    provenance: { origins: ["gui"] },
  });
}

function guiIdentity(
  label: string,
  value?: string | null,
): SourceResolvedField {
  return SourceResolvedFieldSchema.parse({
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "identity",
    explicitValue: value ?? null,
    provenance: { origins: ["gui"] },
  });
}

function rulebookMechanical(
  label: string,
  options: {
    range?: { min: number; max: number };
    explicitValue?: number;
  } = {},
): SourceResolvedField {
  return SourceResolvedFieldSchema.parse({
    canonicalKey: canonicalizeFieldLabel(label),
    label,
    category: "mechanical",
    ...(options.range !== undefined
      ? { permittedValueRange: options.range }
      : {}),
    ...(options.explicitValue !== undefined
      ? { explicitValue: options.explicitValue }
      : {}),
    provenance: {
      origins: ["rulebook"],
      ruleIds: ["rule-1", "rule-2"],
      citations: rulebookCitations,
    },
  });
}

describe("resolveSources", () => {
  it("resolves a GUI-only source without conflicts or fabricated evidence", () => {
    const gui = [guiMechanical("Strength", 20)];
    const result = resolveSources({ gui, rulebook: [] });

    expect(SourceResolutionResultSchema.safeParse(result).success).toBe(true);
    expect(result.fields).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(result.fields[0]).toEqual(gui[0]);
    expect(result.fields[0]?.provenance).toEqual({ origins: ["gui"] });
    expect(result.fields[0]?.provenance).not.toHaveProperty("ruleIds");
  });

  it("resolves a rulebook-only source retaining its rule evidence", () => {
    const rulebook = [rulebookMechanical("Strength", { range: rulebookRange })];
    const result = resolveSources({ gui: [], rulebook });

    expect(result.fields).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(result.fields[0]?.provenance.origins).toEqual(["rulebook"]);
    expect(result.fields[0]?.provenance.ruleIds).toEqual(["rule-1", "rule-2"]);
    expect(result.fields[0]?.provenance.citations).toEqual(rulebookCitations);
  });

  it("keeps unrelated GUI and rulebook fields additive", () => {
    const result = resolveSources({
      gui: [guiMechanical("Vigor")],
      rulebook: [
        rulebookMechanical("Constitution", { range: rulebookRange }),
        rulebookMechanical("Armor", { range: { min: 0, max: 20 } }),
      ],
    });

    expect(result.fields.map((field) => field.canonicalKey)).toEqual([
      "vigor",
      "constitution",
      "armor",
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("merges an exact duplicate into one field preserving the GUI label and evidence", () => {
    const result = resolveSources({
      gui: [guiMechanical("STRENGTH")],
      rulebook: [rulebookMechanical("Strength", { range: rulebookRange })],
    });

    expect(result.fields).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    const field = result.fields[0];
    expect(field?.label).toBe("STRENGTH");
    expect(field?.canonicalKey).toBe("strength");
    expect(field?.explicitValue).toBeUndefined();
    expect(field?.permittedValueRange).toEqual(rulebookRange);
    expect(field?.provenance.origins).toEqual(["gui", "rulebook"]);
    expect(field?.provenance.ruleIds).toEqual(["rule-1", "rule-2"]);
    expect(field?.provenance.citations).toEqual(rulebookCitations);
  });

  it("deduplicates provenance evidence deterministically across duplicates", () => {
    const first = rulebookMechanical("Strength", { range: rulebookRange });
    const second = rulebookMechanical("Strength", { range: rulebookRange });
    second.provenance = {
      origins: ["rulebook"],
      ruleIds: ["rule-2", "rule-3"],
      citations: [
        {
          sourceId: "src-1",
          pageStart: 10,
          pageEnd: 12,
          section: "Chapter 3",
          chunkId: null,
        },
      ],
    };

    const result = resolveSources({
      gui: [guiMechanical("Strength")],
      rulebook: [first, second],
    });

    expect(result.fields).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    const field = result.fields[0];
    expect(field?.provenance.origins).toEqual(["gui", "rulebook"]);
    expect(field?.provenance.ruleIds).toEqual(["rule-1", "rule-2", "rule-3"]);
    expect(field?.provenance.citations).toHaveLength(2);
  });

  it("keeps Vigor and Constitution as distinct fields (mandatory regression)", () => {
    const result = resolveSources({
      gui: [guiMechanical("Vigor")],
      rulebook: [rulebookMechanical("Constitution", { range: rulebookRange })],
    });

    expect(result.fields.map((field) => field.canonicalKey)).toEqual([
      "vigor",
      "constitution",
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("never merges mechanical and identity across categories for the same canonical label", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength", 14)],
      rulebook: [guiIdentity("Strength", "Might")],
    });

    expect(result.fields).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(result.fields[0]?.category).toBe("mechanical");
    expect(result.fields[1]?.category).toBe("identity");
  });

  it("preserves deterministic ordering per the authoring rule", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength"), guiMechanical("Vigor")],
      rulebook: [
        rulebookMechanical("Strength", { range: rulebookRange }),
        rulebookMechanical("Constitution", { range: rulebookRange }),
        rulebookMechanical("Armor", { range: { min: 0, max: 20 } }),
      ],
    });

    expect(result.fields.map((field) => field.canonicalKey)).toEqual([
      "strength",
      "vigor",
      "constitution",
      "armor",
    ]);
    expect(result.fields[0]?.label).toBe("Strength");
    expect(result.conflicts).toEqual([]);
  });

  it("keeps an exact duplicate at the GUI authoring position even when it appears later in rulebook order", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength"), guiMechanical("Vigor")],
      rulebook: [
        rulebookMechanical("Constitution", { range: rulebookRange }),
        rulebookMechanical("Strength", { range: rulebookRange }),
        rulebookMechanical("Armor", { range: { min: 0, max: 20 } }),
      ],
    });

    expect(result.fields.map((field) => field.canonicalKey)).toEqual([
      "strength",
      "vigor",
      "constitution",
      "armor",
    ]);
    expect(result.fields[0]?.provenance.origins).toEqual(["gui", "rulebook"]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps GUI mechanical Notes and rulebook identity Notes in distinct namespaces", () => {
    const result = resolveSources({
      gui: [guiMechanical("Notes")],
      rulebook: [
        SourceResolvedFieldSchema.parse({
          canonicalKey: canonicalizeFieldLabel("Notes"),
          label: "Notes",
          category: "identity",
          explicitValue: "DM notes",
          provenance: { origins: ["rulebook"], ruleIds: ["rule-1"] },
        }),
      ],
    });

    expect(result.fields).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(result.fields[0]?.category).toBe("mechanical");
    expect(result.fields[1]?.category).toBe("identity");
    expect(result.fields[1]?.provenance.origins).toEqual(["rulebook"]);
  });

  it("retains citations up to the provenance contract ceiling of 64 in first-occurrence order", () => {
    const first = rulebookMechanical("Strength", { range: rulebookRange });
    const second = rulebookMechanical("Strength", { range: rulebookRange });
    const makeCitations = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        sourceId: `${prefix}-${index}`,
        pageStart: index + 1,
        pageEnd: index + 1,
        section: null,
        chunkId: null,
      }));
    first.provenance = {
      origins: ["rulebook"],
      ruleIds: ["rule-1"],
      citations: makeCitations("first", 40),
    };
    second.provenance = {
      origins: ["rulebook"],
      ruleIds: ["rule-2"],
      citations: makeCitations("second", 40),
    };

    const result = resolveSources({
      gui: [guiMechanical("Strength")],
      rulebook: [first, second],
    });

    const citations = result.fields[0]?.provenance.citations ?? [];
    expect(citations).toHaveLength(64);
    expect(citations[0]?.sourceId).toBe("first-0");
    expect(citations[63]?.sourceId).toBe("second-23");
    expect(SourceResolutionResultSchema.safeParse(result).success).toBe(true);
  });

  it("merges an explicit value inside an equal-authority range without conflict", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength", 14)],
      rulebook: [rulebookMechanical("Strength", { range: rulebookRange })],
    });

    expect(result.conflicts).toEqual([]);
    const field = result.fields[0];
    expect(field?.explicitValue).toBe(14);
    expect(field?.permittedValueRange).toEqual(rulebookRange);
    expect(field?.provenance.origins).toEqual(["gui", "rulebook"]);
  });

  it("flags an explicit value outside an equal-authority range visibly without clipping", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength", 20)],
      rulebook: [rulebookMechanical("Strength", { range: rulebookRange })],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.code).toBe("INVALID_CONSTRAINT_VALUE");
    expect(result.conflicts[0]?.canonicalKey).toBe("strength");
    const field = result.fields[0];
    expect(field?.explicitValue).toBe(20);
    expect(field?.permittedValueRange).toEqual(rulebookRange);
  });

  it("flags definitionally incompatible duplicates visibly without a silent winner", () => {
    const result = resolveSources({
      gui: [guiMechanicalWithRange("Strength", { min: 1, max: 5 })],
      rulebook: [rulebookMechanical("Strength", { range: rulebookRange })],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.code).toBe(
      "DUPLICATE_CANONICAL_KEY_INCOMPATIBLE",
    );
    expect(result.conflicts[0]?.canonicalKey).toBe("strength");
    expect(result.fields).toHaveLength(1);
    const field = result.fields[0];
    expect(field?.label).toBe("Strength");
    expect(field?.permittedValueRange).toEqual({ min: 1, max: 5 });
    expect(field?.provenance.origins).toEqual(["gui"]);
  });

  it("flags mechanical value disagreement without inventing precedence", () => {
    const result = resolveSources({
      gui: [guiMechanical("Strength", 14)],
      rulebook: [rulebookMechanical("Strength", { explicitValue: 20 })],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.code).toBe(
      "EQUAL_AUTHORITY_MECHANICAL_DISAGREEMENT",
    );
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.explicitValue).toBe(14);
    expect(result.fields[0]?.provenance).toEqual({ origins: ["gui"] });
  });
});
