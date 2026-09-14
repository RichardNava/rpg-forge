import { describe, expect, it } from "vitest";
import {
  bumpDraftVersion,
  DraftError,
  initialDraftVersion,
  nextDraftVersion,
  type CharacterSheetDraft,
} from "./index";
import { makeDraft } from "./draft-fixture";

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

  it("creates an immutable initial snapshot at version 1", () => {
    const base = makeDraft();
    const { version: _version, baseVersion: _base, ...rest } = base;
    const initial = initialDraftVersion(
      rest as Omit<CharacterSheetDraft, "version" | "baseVersion">,
    );
    expect(initial.version).toBe(1);
    expect(initial.baseVersion).toBe(1);
  });

  it("bumps a snapshot without moving its base version", () => {
    const draft = makeDraft();
    const bumped = bumpDraftVersion(draft);
    expect(bumped.version).toBe(2);
    expect(bumped.baseVersion).toBe(1);
    expect(bumped.values.strength).toBe(draft.values.strength);
    expect(draft.version).toBe(1);
  });
});
