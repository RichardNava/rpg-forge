import type { CharacterSheetDraft } from "./draft-schema";
import { draftError } from "./errors";

export type AuthoringSessionStatus = "ACTIVE" | "DELETING";

/** Structural snapshot of a temporary character-sheet session, transport-neutral. */
export interface AuthoringSessionSnapshot {
  sessionId: string;
  status: AuthoringSessionStatus;
  expiresAtMs: number;
}

/** A draft must never outlive the session that owns it. */
export function assertSessionActive(
  session: AuthoringSessionSnapshot,
  nowMs: number,
): void {
  if (session.status !== "ACTIVE") {
    throw draftError("session_expired", "The sheet session is not active.");
  }
  if (nowMs >= session.expiresAtMs) {
    throw draftError("session_expired", "The sheet session has expired.");
  }
}

export function draftBelongsToSession(
  draft: CharacterSheetDraft,
  sessionId: string,
): boolean {
  return draft.sessionId === sessionId;
}

export function assertDraftBelongsToSession(
  draft: CharacterSheetDraft,
  sessionId: string,
): void {
  if (!draftBelongsToSession(draft, sessionId)) {
    throw draftError(
      "draft_session_mismatch",
      "The draft does not belong to the authoring session.",
    );
  }
}

/** Session-side counterpart of `assertDraftBelongsToSession` (same predicate). */
export function assertSessionMatchesDraft(
  session: AuthoringSessionSnapshot,
  draft: CharacterSheetDraft,
): void {
  assertDraftBelongsToSession(draft, session.sessionId);
}

/** Composes the session constraints an authoring entry point must enforce. */
export function validateAuthoringContext(input: {
  session: AuthoringSessionSnapshot;
  draft: CharacterSheetDraft;
  nowMs: number;
}): void {
  assertSessionMatchesDraft(input.session, input.draft);
  assertSessionActive(input.session, input.nowMs);
}

export interface AuthoringSessionProfile {
  sessionId: string;
  status: AuthoringSessionStatus;
  expiresAtMs: number;
  active: boolean;
  draftId: string | null;
  mode: "pc" | "npc" | null;
}

export function profileAuthoringSession(
  session: AuthoringSessionSnapshot,
  draft: CharacterSheetDraft | null,
  nowMs?: number,
): AuthoringSessionProfile {
  const notExpired = nowMs === undefined || nowMs < session.expiresAtMs;
  return {
    sessionId: session.sessionId,
    status: session.status,
    expiresAtMs: session.expiresAtMs,
    active: session.status === "ACTIVE" && notExpired,
    draftId: draft?.draftId ?? null,
    mode: draft?.mode ?? null,
  };
}
