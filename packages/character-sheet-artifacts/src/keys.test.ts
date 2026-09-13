import { describe, expect, it } from "vitest";
import {
  CharacterSheetArtifactError,
  CHARACTER_SHEET_ARTIFACT_KEY_VERSION,
  artifactPathSegment,
  getRunArtifactKeys,
  getRunArtifactPrefix,
  getSessionArtifactPrefix,
} from "./index.js";

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const RUN_ID = "c2d5c4e1-1b0a-4c2d-8e4f-2a8b9c0d1e2f";

describe("artifactPathSegment", () => {
  it("accepts a UUID unchanged", () => {
    expect(artifactPathSegment(SESSION_ID, "sessionId")).toBe(SESSION_ID);
  });

  it("percent-encodes unsafe characters", () => {
    expect(artifactPathSegment("my session 1", "sessionId")).toBe(
      "my%20session%201",
    );
  });

  it("keeps unreserved identifier characters untouched", () => {
    expect(artifactPathSegment("id.with-dots_0123-ok", "runId")).toBe(
      "id.with-dots_0123-ok",
    );
    expect(artifactPathSegment("id:with:colon", "runId")).toBe(
      "id%3Awith%3Acolon",
    );
  });

  it("rejects an empty segment", () => {
    expect(() => artifactPathSegment("", "runId")).toThrow(
      CharacterSheetArtifactError,
    );
  });

  it("rejects an overlong segment", () => {
    expect(() => artifactPathSegment("x".repeat(129), "runId")).toThrow(
      CharacterSheetArtifactError,
    );
  });

  it("rejects a slash, backslash, or parent traversal", () => {
    expect(() => artifactPathSegment("../escape", "sessionId")).toThrow(
      CharacterSheetArtifactError,
    );
    expect(() => artifactPathSegment("a\\b", "sessionId")).toThrow(
      CharacterSheetArtifactError,
    );
    expect(() => artifactPathSegment("a/b", "sessionId")).toThrow(
      CharacterSheetArtifactError,
    );
    expect(() => artifactPathSegment("a..b", "sessionId")).toThrow(
      CharacterSheetArtifactError,
    );
  });
});

describe("artifact keys", () => {
  it("builds the documented run key layout", () => {
    expect(getRunArtifactKeys(SESSION_ID, RUN_ID)).toEqual({
      spec: `temp/character-sheets/${CHARACTER_SHEET_ARTIFACT_KEY_VERSION}/sessions/${SESSION_ID}/runs/${RUN_ID}/spec.json`,
      pdf: `temp/character-sheets/${CHARACTER_SHEET_ARTIFACT_KEY_VERSION}/sessions/${SESSION_ID}/runs/${RUN_ID}/sheet.pdf`,
    });
  });

  it("session prefix ends with a separator", () => {
    const prefix = getSessionArtifactPrefix(SESSION_ID);
    expect(prefix.endsWith("/")).toBe(true);
    expect(prefix).toBe(
      `temp/character-sheets/${CHARACTER_SHEET_ARTIFACT_KEY_VERSION}/sessions/${SESSION_ID}/`,
    );
  });

  it("run prefix ends with a separator", () => {
    const prefix = getRunArtifactPrefix(SESSION_ID, RUN_ID);
    expect(prefix.endsWith("/")).toBe(true);
    expect(prefix).toBe(
      `temp/character-sheets/${CHARACTER_SHEET_ARTIFACT_KEY_VERSION}/sessions/${SESSION_ID}/runs/${RUN_ID}/`,
    );
  });

  it("similar-prefix sessions are isolated by the trailing separator", () => {
    const prefixA = getSessionArtifactPrefix("session-a");
    const prefixB = getSessionArtifactPrefix("session-a2");

    expect(prefixA.endsWith("/")).toBe(true);
    expect(prefixA.endsWith("session-a/")).toBe(true);

    const keyUnderB = `${prefixB}runs/run-1/spec.json`;
    expect(keyUnderB.startsWith(prefixA)).toBe(false);

    const keyUnderA = `${prefixA}runs/run-1/spec.json`;
    expect(keyUnderA.startsWith(prefixB)).toBe(false);
  });

  it("similar-prefix runs are isolated by the trailing separator", () => {
    const prefixShort = getRunArtifactPrefix(SESSION_ID, "run-1");
    const prefixLong = getRunArtifactPrefix(SESSION_ID, "run-10");

    expect(prefixShort.endsWith("/")).toBe(true);
    expect(prefixShort.endsWith("run-1/")).toBe(true);

    const fileUnderLong = `${prefixLong}spec.json`;
    expect(fileUnderLong.startsWith(prefixShort)).toBe(false);

    const fileUnderShort = `${prefixShort}spec.json`;
    expect(fileUnderShort.startsWith(prefixLong)).toBe(false);
  });

  it("keys stay within the session prefix so cleanup cannot cross sessions", () => {
    const otherSession = getRunArtifactKeys("other-session", RUN_ID).spec;
    expect(otherSession).not.toContain(`/${SESSION_ID}/`);
    expect(
      otherSession.startsWith(getSessionArtifactPrefix("other-session")),
    ).toBe(true);
  });
});
