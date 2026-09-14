import { describe, expect, it } from "vitest";
import {
  draftPathSegment,
  DraftError,
  getDraftPrefix,
  getDraftSnapshotKey,
  getSessionDraftsPrefix,
  parseDraftVersionFromObjectKey,
} from "./index";

const SESSION = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT = "draft.4f1e8a2b-c3d4-4e5f-8a6b-7c090d1e2f3a";

describe("draft R2 keys", () => {
  it("builds the session drafts prefix with a trailing separator", () => {
    expect(getSessionDraftsPrefix(SESSION)).toBe(
      `temp/character-sheets/v1/sessions/${encodeURIComponent(SESSION)}/drafts/`,
    );
  });

  it("builds the draft prefix and versioned snapshot keys", () => {
    const prefix = getDraftPrefix(SESSION, DRAFT);
    expect(prefix).toBe(
      `temp/character-sheets/v1/sessions/${encodeURIComponent(SESSION)}/drafts/${encodeURIComponent(DRAFT)}/`,
    );
    expect(getDraftSnapshotKey(SESSION, DRAFT, 3)).toBe(`${prefix}v3.json`);
  });

  it("is isolated by session and draft with similar ids", () => {
    const a = getSessionDraftsPrefix("session-a");
    const a2 = getSessionDraftsPrefix("session-a2");
    expect(a2.startsWith(a)).toBe(false);
    const run1 = getDraftPrefix(SESSION, "draft-1");
    const run10 = getDraftPrefix(SESSION, "draft-10");
    expect(run10.startsWith(run1)).toBe(false);
  });

  it("guards identity segments", () => {
    const cases: Array<[string, string]> = [
      ["", "sessionId"],
      ["..", "draftId"],
      ["a/b", "draftId"],
      ["a\\b", "draftId"],
    ];
    for (const [value, label] of cases) {
      expect(() => draftPathSegment(value, label)).toThrowError(DraftError);
    }
    expect(() => draftPathSegment("x".repeat(129), "draftId")).toThrowError(
      DraftError,
    );
  });

  it("guards versions", () => {
    expect(() => getDraftSnapshotKey(SESSION, DRAFT, 0)).toThrowError(
      DraftError,
    );
    expect(() => getDraftSnapshotKey(SESSION, DRAFT, 1.5)).toThrowError(
      DraftError,
    );
  });

  it("parses versioned keys under a draft prefix only", () => {
    const prefix = getDraftPrefix(SESSION, DRAFT);
    expect(parseDraftVersionFromObjectKey(`${prefix}v7.json`, prefix)).toBe(7);
    expect(
      parseDraftVersionFromObjectKey(`${prefix}manifest.json`, prefix),
    ).toBeNull();
    expect(
      parseDraftVersionFromObjectKey(`${prefix}sub/v7.json`, prefix),
    ).toBeNull();
    const other = getDraftPrefix(SESSION, "draft.other");
    expect(
      parseDraftVersionFromObjectKey(`${other}v7.json`, prefix),
    ).toBeNull();
  });
});
