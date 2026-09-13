import { describe, expect, it, vi } from "vitest";
import {
  extractSheetTemplate,
  type CharacterSheetTemplateExtractionPort,
} from "./index.js";

const source = {
  kind: "direct-sheet" as const,
  sheetKey: "fixture-sheet",
};

const validRaw = JSON.stringify({
  schemaVersion: 1,
  mode: "pc",
  sections: [{ key: "identity", title: "Identity" }],
  fields: [
    { label: "Character Name", category: "identity", kind: "text" },
    {
      label: "Vigor",
      category: "mechanical",
      kind: "number",
      numericBounds: { min: 1, max: 10 },
    },
  ],
});

function portReturning(
  raw: string | (() => string),
): CharacterSheetTemplateExtractionPort {
  return {
    extract: vi.fn(async () => (typeof raw === "function" ? raw() : raw)),
  };
}

describe("extractSheetTemplate", () => {
  it("returns a validated template for valid JSON", async () => {
    const outcome = await extractSheetTemplate(
      { source },
      { extractionPort: portReturning(validRaw) },
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.template.fields.map((field) => field.label)).toEqual([
        "Character Name",
        "Vigor",
      ]);
    }
  });

  it("reports extraction_unavailable when the provider throws", async () => {
    const outcome = await extractSheetTemplate(
      { source },
      {
        extractionPort: {
          extract: async () => {
            throw new Error("provider down");
          },
        },
      },
    );
    expect(outcome).toEqual({ kind: "extraction_unavailable" });
  });

  it("corrects invalid output within the bounded retry budget", async () => {
    const calls: string[] = [];
    const outcome = await extractSheetTemplate(
      { source },
      {
        extractionPort: {
          extract: async ({ system, user }) => {
            calls.push(user);
            if (calls.length === 1) {
              return "this is not json";
            }
            return validRaw;
          },
        },
      },
    );
    expect(outcome.kind).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("previous response was rejected");
  });

  it("fails as invalid_proposal when retries stay invalid", async () => {
    const outcome = await extractSheetTemplate(
      { source },
      { extractionPort: portReturning("{}") },
    );
    expect(outcome.kind).toBe("invalid_proposal");
  });

  it("regenerates from scratch each retry instead of mutating the base prompt", async () => {
    const baseUser = "Describe the template";
    const outcome = await extractSheetTemplate(
      { source },
      { extractionPort: portReturning("{") },
    );
    expect(outcome.kind).toBe("invalid_proposal");
    if (outcome.kind === "invalid_proposal") {
      expect(outcome.message).toContain("valid JSON");
    }
    expect(baseUser.length).toBeGreaterThan(0);
  });
});
