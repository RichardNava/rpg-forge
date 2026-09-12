import { describe, expect, it } from "vitest";

import {
  extractFinishReason,
  extractResponseText,
  extractUsage,
  getSchemaForStage,
  isSheetGenerationStage,
  MAX_SHEET_BENCH_OUTPUT_TOKENS,
  STAGE_JSON_SCHEMA,
} from "./stage-config.js";

describe("sheet-benchmark shim worker", () => {
  it("maps every stage to a production-derived json_schema", () => {
    expect(Object.keys(STAGE_JSON_SCHEMA).sort()).toEqual([
      "calculations",
      "field-candidates",
      "section-plan",
    ]);
    for (const schema of Object.values(STAGE_JSON_SCHEMA)) {
      expect(schema).toEqual(expect.any(Object));
      expect((schema as { $schema?: unknown }).$schema).toEqual(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect((schema as { type?: unknown }).type).toBe("object");
      expect((schema as { required?: unknown }).required).toEqual(
        expect.any(Array),
      );
    }
  });

  it("recognizes only the three sheet-generation stages", () => {
    expect(isSheetGenerationStage("section-plan")).toBe(true);
    expect(isSheetGenerationStage("field-candidates")).toBe(true);
    expect(isSheetGenerationStage("calculations")).toBe(true);
    expect(isSheetGenerationStage("compile")).toBe(false);
    expect(isSheetGenerationStage("")).toBe(false);
    expect(isSheetGenerationStage(42)).toBe(false);
    expect(isSheetGenerationStage(undefined)).toBe(false);
  });

  it("bounds output to the production cap", () => {
    expect(MAX_SHEET_BENCH_OUTPUT_TOKENS).toBe(8192);
  });

  it("returns the default schema for null persona", () => {
    const schema = getSchemaForStage("section-plan", null);
    expect(schema).toEqual(STAGE_JSON_SCHEMA["section-plan"]);
  });

  it("returns the default schema for field-candidates and calculations regardless of persona", () => {
    expect(getSchemaForStage("field-candidates", "human-locale")).toEqual(
      STAGE_JSON_SCHEMA["field-candidates"],
    );
    expect(getSchemaForStage("calculations", "strict-schema")).toEqual(
      STAGE_JSON_SCHEMA["calculations"],
    );
  });

  it("extracts plain-string and response-object text", () => {
    expect(extractResponseText("plain")).toBe("plain");
    expect(extractResponseText({ response: "object" })).toBe("object");
  });

  it("rejects empty or unusable provider results", () => {
    expect(extractResponseText("")).toBeNull();
    expect(extractResponseText({ response: "" })).toBeNull();
    expect(extractResponseText({ response: 42 })).toBeNull();
    expect(extractResponseText({})).toBeNull();
    expect(extractResponseText([])).toBeNull();
    expect(extractResponseText(null)).toBeNull();
    expect(extractResponseText(undefined)).toBeNull();
  });

  it("extracts finish reasons from choices, top-level, and null", () => {
    expect(extractFinishReason({ choices: [{ finish_reason: "stop" }] })).toBe(
      "stop",
    );
    expect(extractFinishReason({ choices: [{ finishReason: "length" }] })).toBe(
      "length",
    );
    expect(extractFinishReason({ finish_reason: "stop" })).toBe("stop");
    expect(extractFinishReason({ stop_reason: "end_turn" })).toBe("end_turn");
    expect(extractFinishReason({ response: "text" })).toBeNull();
    expect(extractFinishReason({ choices: [] })).toBeNull();
    expect(extractFinishReason("plain")).toBeNull();
    expect(extractFinishReason(null)).toBeNull();
  });

  it("extracts usage metadata when present and null otherwise", () => {
    const usage = { input_tokens: 12, output_tokens: 30 };
    expect(extractUsage({ usage })).toEqual(usage);
    expect(extractUsage({ usageMetadata: usage })).toEqual(usage);
    expect(extractUsage({ usage_metadata: usage })).toEqual(usage);
    expect(extractUsage({ response: "text" })).toBeNull();
    expect(extractUsage("plain")).toBeNull();
    expect(extractUsage(null)).toBeNull();
  });
});
