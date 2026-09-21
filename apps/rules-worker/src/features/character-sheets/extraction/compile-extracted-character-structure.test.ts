import { describe, expect, it } from "vitest";
import { compileExtractedCharacterStructure } from "./compile-extracted-character-structure.js";

describe("compileExtractedCharacterStructure", () => {
  it("compiles nested observed sections, ratings, values, and unassigned fields", () => {
    const draft = compileExtractedCharacterStructure({
      sessionId: "session.123",
      sourceSheetId: "sheet",
      structure: {
        schemaVersion: "1",
        document: { pageCount: 1 },
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
                    control: {
                      kind: "rating",
                      constraints: { min: 0, max: 5 },
                    },
                    value: 3,
                  },
                ],
              },
            ],
          },
          {
            kind: "field",
            label: "Notes",
            control: { kind: "textarea" },
            value: "Observed",
          },
        ],
      },
    });

    expect(draft.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "strength",
          type: "number",
          min: 0,
          max: 5,
        }),
        expect.objectContaining({ key: "notes", type: "textarea" }),
      ]),
    );
    expect(draft.values).toMatchObject({ strength: 3, notes: "Observed" });
    expect(draft.sections).toEqual([
      expect.objectContaining({ key: "attributes", fieldKeys: [] }),
      expect.objectContaining({
        key: "physical",
        parentKey: "attributes",
        fieldKeys: ["strength"],
      }),
    ]);
  });

  it("generates unique safe keys and omits incompatible observed values", () => {
    const draft = compileExtractedCharacterStructure({
      sessionId: "session.123",
      sourceSheetId: null,
      structure: {
        schemaVersion: "1",
        document: { pageCount: 1 },
        nodes: [
          { kind: "field", label: "Aptitud!", control: { kind: "text" } },
          {
            kind: "field",
            label: "Aptitud?",
            control: { kind: "number" },
            value: "not-a-number",
          },
        ],
      },
    });
    expect(draft.fields.map((field) => field.key)).toEqual([
      "aptitud",
      "aptitud_2",
    ]);
    expect(draft.values).toEqual({});
  });
});
