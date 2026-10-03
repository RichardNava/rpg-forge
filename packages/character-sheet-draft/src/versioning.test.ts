import { describe, expect, it } from "vitest";
import { DraftError, nextDraftVersion } from "./index";

describe("draft versioning", () => {
  it("bumps positive integer versions", () => {
    expect(nextDraftVersion(1)).toBe(2);
    expect(nextDraftVersion(41)).toBe(42);
  });

  it("rejects non-positive versions", () => {
    for (const version of [0, -1, 1.5, NaN]) {
      expect(() => nextDraftVersion(version)).toThrowError(DraftError);
    }
  });
});
