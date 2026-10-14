import { describe, expect, it } from "vitest";
import {
  FinalPresentationPlanV1Schema,
  FinalPresentationStyleV1Schema,
  PresentationVariantSchema,
  OrnamentDensitySchema,
  ContrastLevelSchema,
  SectionEmphasisSchema,
  FieldEmphasisSchema,
  validatePresentationPlanForStyle,
  getStyleProfile,
  createStructuralSummary,
  buildPresentationSystemPrompt,
  PRESENTATION_TOKENS,
  type FinalPresentationPlanV1,
  type FinalPresentationStyleV1,
  type StructuralSummaryV1,
} from "./final-presentation.js";

describe("FinalPresentationPlanV1Schema", () => {
  it("accepts a valid medieval plan", () => {
    const plan: FinalPresentationPlanV1 = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it("accepts a valid sci-fi plan", () => {
    const plan: FinalPresentationPlanV1 = {
      schemaVersion: "1",
      style: "sci-fi",
      variant: "compact",
      ornamentDensity: "none",
      contrast: "high",
      sectionEmphasis: "minimal",
      fieldEmphasis: "pronounced",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it("rejects unknown style", () => {
    const plan = {
      schemaVersion: "1",
      style: "fantasy",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects unknown variant", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "fancy",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects unknown ornamentDensity", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "extreme",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects unknown contrast", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "ultra",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects unknown sectionEmphasis", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "extreme",
      fieldEmphasis: "standard",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects unknown fieldEmphasis", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "extreme",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects extra properties", () => {
    const plan = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
      extraField: "not allowed",
    };
    const result = FinalPresentationPlanV1Schema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});

describe("Presentation enums", () => {
  it("FinalPresentationStyleV1Schema has exactly two values", () => {
    expect(FinalPresentationStyleV1Schema.options).toEqual(["medieval", "sci-fi"]);
  });

  it("PresentationVariantSchema has three values", () => {
    expect(PresentationVariantSchema.options).toEqual(["standard", "compact", "ornate"]);
  });

  it("OrnamentDensitySchema has four values", () => {
    expect(OrnamentDensitySchema.options).toEqual(["none", "light", "medium", "heavy"]);
  });

  it("ContrastLevelSchema has three values", () => {
    expect(ContrastLevelSchema.options).toEqual(["low", "medium", "high"]);
  });

  it("SectionEmphasisSchema has three values", () => {
    expect(SectionEmphasisSchema.options).toEqual(["minimal", "standard", "pronounced"]);
  });

  it("FieldEmphasisSchema has three values", () => {
    expect(FieldEmphasisSchema.options).toEqual(["minimal", "standard", "pronounced"]);
  });
});

describe("Style profiles", () => {
  it("getStyleProfile returns medieval profile", () => {
    const profile = getStyleProfile("medieval");
    expect(profile.key).toBe("medieval");
    expect(profile.label).toBe("Medieval");
    expect(profile.typography.headingFont).toBe("Times-Roman");
    expect(profile.palette.background).toBe("#fdf6e3");
  });

  it("getStyleProfile returns sci-fi profile", () => {
    const profile = getStyleProfile("sci-fi");
    expect(profile.key).toBe("sci-fi");
    expect(profile.label).toBe("Sci-fi");
    expect(profile.typography.headingFont).toBe("Courier");
    expect(profile.palette.background).toBe("#0a1628");
  });

  it("getStyleProfile throws for unknown style", () => {
    expect(() => getStyleProfile("fantasy" as any)).toThrow("Unknown presentation style");
  });

  it("medieval profile has correct forbidden transformations", () => {
    const profile = getStyleProfile("medieval");
    expect(profile.forbiddenTransformations).toContain("neon-colors");
    expect(profile.forbiddenTransformations).toContain("glow-effects");
    expect(profile.forbiddenTransformations).not.toContain("parchment-texture");
  });

  it("sci-fi profile has correct forbidden transformations", () => {
    const profile = getStyleProfile("sci-fi");
    expect(profile.forbiddenTransformations).toContain("parchment-texture");
    expect(profile.forbiddenTransformations).toContain("ink-blot");
    expect(profile.forbiddenTransformations).toContain("calligraphy");
    expect(profile.forbiddenTransformations).not.toContain("neon-colors");
  });

  it("medieval allowed variants are standard, compact, ornate", () => {
    const profile = getStyleProfile("medieval");
    expect(profile.allowedVariants).toEqual(["standard", "compact", "ornate"]);
  });

  it("sci-fi allowed variants are standard, compact, ornate", () => {
    const profile = getStyleProfile("sci-fi");
    expect(profile.allowedVariants).toEqual(["standard", "compact", "ornate"]);
  });
});

describe("validatePresentationPlanForStyle", () => {
  it("accepts standard variant for medieval", () => {
    const plan: FinalPresentationPlanV1 = {
      schemaVersion: "1",
      style: "medieval",
      variant: "standard",
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    expect(() => validatePresentationPlanForStyle(plan, "medieval")).not.toThrow();
  });

  it("accepts ornate variant for sci-fi", () => {
    const plan: FinalPresentationPlanV1 = {
      schemaVersion: "1",
      style: "sci-fi",
      variant: "ornate",
      ornamentDensity: "heavy",
      contrast: "high",
      sectionEmphasis: "pronounced",
      fieldEmphasis: "pronounced",
    };
    expect(() => validatePresentationPlanForStyle(plan, "sci-fi")).not.toThrow();
  });

  it("rejects variant not in allowed list", () => {
    const plan: FinalPresentationPlanV1 = {
      schemaVersion: "1",
      style: "medieval",
      variant: "fancy" as any,
      ornamentDensity: "light",
      contrast: "medium",
      sectionEmphasis: "standard",
      fieldEmphasis: "standard",
    };
    expect(() => validatePresentationPlanForStyle(plan, "medieval")).toThrow(
      "Variant fancy not allowed for style medieval",
    );
  });
});

describe("createStructuralSummary", () => {
  it("creates summary for PC draft", () => {
    const draft = {
      mode: "pc" as const,
      fields: [
        { key: "a", parentKey: "s1" as string | null },
        { key: "b", parentKey: "s1" as string | null },
        { key: "c", parentKey: null as string | null },
      ],
      sections: [{ key: "s1", parentKey: null as string | null }],
      structure: [
        { kind: "section" as const, key: "s1", parentKey: null },
        { kind: "field" as const, key: "a", parentKey: "s1" },
        { kind: "field" as const, key: "b", parentKey: "s1" },
        { kind: "field" as const, key: "c", parentKey: null },
      ],
      layout: { root: { columns: 2 } },
    };
    const summary = createStructuralSummary(draft);
    expect(summary.mode).toBe("pc");
    expect(summary.fieldCount).toBe(3);
    expect(summary.sectionCount).toBe(1);
    expect(summary.maxNestingDepth).toBe(1);
    expect(summary.rootColumns).toBe(2);
    expect(summary.hasLayout).toBe(true);
    expect(summary.density).toBe("sparse");
  });

  it("calculates nesting depth correctly", () => {
    const draft = {
      mode: "npc" as const,
      fields: [{ key: "a", parentKey: "s2" as string | null }],
      sections: [{ key: "s1", parentKey: null as string | null }, { key: "s2", parentKey: null as string | null }],
      structure: [
        { kind: "section" as const, key: "s1", parentKey: null },
        { kind: "section" as const, key: "s2", parentKey: "s1" },
        { kind: "field" as const, key: "a", parentKey: "s2" },
      ],
      layout: { root: { columns: 1 } },
    };
    const summary = createStructuralSummary(draft);
    expect(summary.maxNestingDepth).toBe(2);
  });

  it("handles draft without layout", () => {
    const draft = {
      mode: "pc" as const,
      fields: [{ key: "a", parentKey: null as string | null }],
      sections: [],
      structure: [{ kind: "field" as const, key: "a", parentKey: null }],
    };
    const summary = createStructuralSummary(draft);
    expect(summary.hasLayout).toBe(false);
    expect(summary.rootColumns).toBe(1);
  });

  it("calculates density correctly", () => {
    const sparseDraft = {
      mode: "pc" as const,
      fields: [{ key: "a", parentKey: null as string | null }, { key: "b", parentKey: null as string | null }],
      sections: [],
      structure: [
        { kind: "field" as const, key: "a", parentKey: null },
        { kind: "field" as const, key: "b", parentKey: null },
      ],
    };
    expect(createStructuralSummary(sparseDraft).density).toBe("sparse");

    const denseDraft = {
      mode: "pc" as const,
      fields: Array.from({ length: 35 }, (_, i) => ({ key: `f${i}`, parentKey: null as string | null })),
      sections: [],
      structure: Array.from({ length: 35 }, (_, i) => ({ kind: "field" as const, key: `f${i}`, parentKey: null })),
    };
    expect(createStructuralSummary(denseDraft).density).toBe("dense");
  });
});

describe("buildPresentationSystemPrompt", () => {
  it("includes style label and constraints", () => {
    const prompt = buildPresentationSystemPrompt("medieval", PRESENTATION_TOKENS);
    expect(prompt).toContain("Medieval");
    expect(prompt).toContain("medieval");
    expect(prompt).toContain("Forbidden transformations");
    expect(prompt).toContain("neon-colors");
    expect(prompt).toContain("glow-effects");
  });

  it("includes allowed tokens", () => {
    const prompt = buildPresentationSystemPrompt("sci-fi", PRESENTATION_TOKENS);
    expect(prompt).toContain("variant: standard, compact, ornate");
    expect(prompt).toContain("ornamentDensity: none, light, medium, heavy");
    expect(prompt).toContain("contrast: low, medium, high");
    expect(prompt).toContain("sectionEmphasis: minimal, standard, pronounced");
    expect(prompt).toContain("fieldEmphasis: minimal, standard, pronounced");
  });

  it("includes schema definition", () => {
    const prompt = buildPresentationSystemPrompt("medieval", PRESENTATION_TOKENS);
    expect(prompt).toContain("schemaVersion");
    expect(prompt).toContain("style");
    expect(prompt).toContain("variant");
    expect(prompt).toContain("ornamentDensity");
    expect(prompt).toContain("contrast");
    expect(prompt).toContain("sectionEmphasis");
    expect(prompt).toContain("fieldEmphasis");
  });

  it("mentions untrusted user data", () => {
    const prompt = buildPresentationSystemPrompt("medieval", PRESENTATION_TOKENS);
    expect(prompt).toContain("UNTRUSTED DATA");
    expect(prompt).toContain("user instructions");
  });
});

describe("PRESENTATION_TOKENS", () => {
  it("contains all expected token arrays", () => {
    expect(PRESENTATION_TOKENS.variants).toEqual(["standard", "compact", "ornate"]);
    expect(PRESENTATION_TOKENS.ornamentDensities).toEqual(["none", "light", "medium", "heavy"]);
    expect(PRESENTATION_TOKENS.contrasts).toEqual(["low", "medium", "high"]);
    expect(PRESENTATION_TOKENS.sectionEmphases).toEqual(["minimal", "standard", "pronounced"]);
    expect(PRESENTATION_TOKENS.fieldEmphases).toEqual(["minimal", "standard", "pronounced"]);
  });
});