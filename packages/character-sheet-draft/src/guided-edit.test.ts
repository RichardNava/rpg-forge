import { describe, expect, it } from "vitest";
import {
  assertDraftWithinBounds,
  assertDraftFieldExists,
  countDraftValues,
  DraftError,
  mustBeWithinDraftSurface,
  pruneSurfaceToDraftBounds,
  surfaceKeys,
} from "./index";
import { makeDraft } from "./draft-fixture";

describe("draft guided-edit surface", () => {
  it("lists surface keys in field order", () => {
    expect(surfaceKeys(makeDraft())).toEqual([
      "character_name",
      "strength",
      "homeland",
      "weapon",
      "veteran",
    ]);
  });

  it("answers membership and finds fields", () => {
    const draft = makeDraft();
    expect(mustBeWithinDraftSurface(draft, "strength")).toBe(true);
    expect(mustBeWithinDraftSurface(draft, "ghost")).toBe(false);
    const field = assertDraftFieldExists(draft, "weapon");
    expect(field.type).toBe("choice");
    expect(() => assertDraftFieldExists(draft, "ghost")).toThrowError(
      DraftError,
    );
    try {
      assertDraftFieldExists(draft, "ghost");
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("surface_out_of_bounds");
    }
  });

  it("counts values", () => {
    expect(countDraftValues(makeDraft())).toBe(5);
  });

  it("prunes unknown value keys while preserving surface entries", () => {
    const draft = makeDraft({
      values: { ...makeDraft().values, ghost: "x" } as never,
    });
    const pruned = pruneSurfaceToDraftBounds(draft);
    expect(Object.keys(pruned.values).sort()).toEqual([
      "character_name",
      "homeland",
      "strength",
      "veteran",
      "weapon",
    ]);
    expect(pruned.values.strength).toBe(12);
  });

  it("bounds-checks the surface", () => {
    const fixed = makeDraft();
    expect(() => assertDraftWithinBounds(fixed)).not.toThrow();
    expect(() =>
      assertDraftWithinBounds(
        makeDraft({ values: { ...fixed.values, ghost: 1 } as never }),
      ),
    ).toThrowError(DraftError);
  });
});
