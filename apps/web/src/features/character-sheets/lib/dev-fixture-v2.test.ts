import { describe, expect, it } from "vitest";
import { createBlankDraftV2, createExampleDraftV2 } from "./dev-fixture-v2";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("dev-fixture-v2", () => {
  it("emits canonical V2 snapshots with explicit structure", () => {
    const blank = createBlankDraftV2(SESSION_ID);
    expect(blank.schemaVersion).toBe("2");
    expect(blank.version).toBe(1);
    expect(blank.baseVersion).toBe(1);
    expect(blank.structure).toEqual([
      { kind: "field", key: "character_name", parentKey: null },
    ]);

    const example = createExampleDraftV2(SESSION_ID);
    expect(example.schemaVersion).toBe("2");
    expect(example.fields).toHaveLength(example.structure.length);
    expect(
      example.structure.every((placement) => placement.kind === "field"),
    ).toBe(true);
    expect(example.structure.map((placement) => placement.key)).toEqual(
      example.fields.map((field) => field.key),
    );
  });
});
