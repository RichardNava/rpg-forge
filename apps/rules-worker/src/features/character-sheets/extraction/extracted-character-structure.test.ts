import { describe, expect, it } from "vitest";
import {
  ExtractedCharacterStructureSchema,
  MAX_EXTRACTED_CHARACTER_DEPTH,
} from "./extracted-character-structure.js";

describe("ExtractedCharacterStructure", () => {
  it("accepts a nested visual observation without RPG Forge draft metadata", () => {
    const result = ExtractedCharacterStructureSchema.safeParse({
      schemaVersion: "1",
      document: { pageCount: 2 },
      nodes: [
        {
          kind: "section",
          label: "Attributes",
          children: [
            {
              kind: "section",
              label: "Physical",
              children: [
                {
                  kind: "field",
                  label: "Strength",
                  control: { kind: "rating", constraints: { min: 0, max: 5 } },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid observed control constraints", () => {
    const result = ExtractedCharacterStructureSchema.safeParse({
      schemaVersion: "1",
      document: { pageCount: 1 },
      nodes: [
        {
          kind: "field",
          label: "Strength",
          control: { kind: "rating", constraints: { min: 5, max: 0 } },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a field pretending to contain child nodes", () => {
    const result = ExtractedCharacterStructureSchema.safeParse({
      schemaVersion: "1",
      document: { pageCount: 1 },
      nodes: [
        {
          kind: "field",
          label: "Name",
          control: { kind: "text" },
          children: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects structures deeper than the observation budget", () => {
    let node: unknown = {
      kind: "field",
      label: "Value",
      control: { kind: "text" },
    };
    for (let index = 0; index < MAX_EXTRACTED_CHARACTER_DEPTH; index += 1) {
      node = { kind: "section", label: `Group ${index}`, children: [node] };
    }
    const result = ExtractedCharacterStructureSchema.safeParse({
      schemaVersion: "1",
      document: { pageCount: 1 },
      nodes: [node],
    });

    expect(result.success).toBe(false);
  });
});
