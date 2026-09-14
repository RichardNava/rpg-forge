import { describe, expect, it } from "vitest";
import {
  assertDraftBelongsToSession,
  assertSessionActive,
  assertSessionMatchesDraft,
  DraftError,
  profileAuthoringSession,
  validateAuthoringContext,
  type AuthoringSessionSnapshot,
} from "./index";
import { makeDraft } from "./draft-fixture";

const activeSession: AuthoringSessionSnapshot = {
  sessionId: "session.abc123",
  status: "ACTIVE",
  expiresAtMs: 1_000_000,
};

describe("authoring session constraints", () => {
  it("passes an active, unexpired session", () => {
    expect(() => assertSessionActive(activeSession, 999_999)).not.toThrow();
  });

  it("rejects an expired session", () => {
    expect(() => assertSessionActive(activeSession, 1_000_000)).toThrowError(
      DraftError,
    );
    try {
      assertSessionActive(activeSession, 1_000_000);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("session_expired");
    }
  });

  it("rejects a non-active session", () => {
    const deleting = { ...activeSession, status: "DELETING" as const };
    expect(() => assertSessionActive(deleting, 1)).toThrowError(DraftError);
  });

  it("rejects a draft from a different session", () => {
    const foreign = makeDraft({ sessionId: "session.deadbeef" });
    expect(() =>
      assertSessionMatchesDraft(activeSession, foreign),
    ).toThrowError(DraftError);
    try {
      assertDraftBelongsToSession(foreign, activeSession.sessionId);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("draft_session_mismatch");
    }
  });

  it("accepts an owned draft", () => {
    expect(() =>
      assertSessionMatchesDraft(activeSession, makeDraft()),
    ).not.toThrow();
  });

  it("composes session + ownership as one authoring gate", () => {
    expect(() =>
      validateAuthoringContext({
        session: activeSession,
        draft: makeDraft(),
        nowMs: 500,
      }),
    ).not.toThrow();
    expect(() =>
      validateAuthoringContext({
        session: activeSession,
        draft: makeDraft(),
        nowMs: 5_000_000,
      }),
    ).toThrowError(DraftError);
    expect(() =>
      validateAuthoringContext({
        session: activeSession,
        draft: makeDraft({ sessionId: "other" }),
        nowMs: 500,
      }),
    ).toThrowError(DraftError);
  });

  it("profiles the authoring context", () => {
    const profile = profileAuthoringSession(activeSession, makeDraft(), 500);
    expect(profile).toEqual({
      sessionId: "session.abc123",
      status: "ACTIVE",
      expiresAtMs: 1_000_000,
      active: true,
      draftId: "draft.abc123",
      mode: "pc",
    });
    const expired = profileAuthoringSession(activeSession, null, 5_000_000);
    expect(expired.active).toBe(false);
    expect(expired.draftId).toBeNull();
    expect(expired.mode).toBeNull();
  });
});
