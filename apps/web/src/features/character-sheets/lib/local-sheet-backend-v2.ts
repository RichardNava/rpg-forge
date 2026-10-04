import {
  DraftError,
  applyDraftMutationV2,
  draftError,
  finalizeDraftV2,
  rerollLockedDraftValuesV2,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
} from "@repo/character-sheet-draft";
import type { SheetSession, SheetSessionView } from "../api/sheet-api-types";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";

export interface LocalSheetBackendV2Options {
  /** Optional seed for the session's deterministic snapshot clock. */
  clock?: () => Date;
}

/**
 * In-memory `SheetApiClientV2Port` used in development when no rules-worker is
 * available. It exercises the real V2 domain rules (the same validation,
 * mutation, reroll and finalize functions the live Worker V2 handlers call),
 * but keeps snapshots in the browser tab instead of R2/D1. Production wiring
 * replaces this with `SheetApiClientV2`; the store and UI are identical either
 * way.
 *
 * This backend is a V2 development/test double, not an R2/D1 simulator: there
 * is no claim/commit lifecycle here. Reroll and confirm compare the request
 * `expectedVersion` against the stored current version first, mirroring the
 * Worker precondition order.
 */
export function createLocalSheetBackendV2(
  options: LocalSheetBackendV2Options = {},
): SheetApiClientV2Port {
  const sessions = new Map<
    string,
    { sessionId: string; accessToken: string }
  >();
  const drafts = new Map<string, CharacterSheetDraftV2>();
  const keyOf = (sessionId: string, draftId: string) =>
    `${sessionId}:${draftId}`;
  const now = options.clock ?? (() => new Date());

  function requireSession(sessionId: string, accessToken: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined || session.accessToken !== accessToken) {
      throw new Error("Session not found.");
    }
  }

  function requireOwnedDraft(
    sessionId: string,
    draftId: string,
  ): CharacterSheetDraftV2 {
    const draft = drafts.get(keyOf(sessionId, draftId));
    if (draft === undefined || draft.sessionId !== sessionId) {
      throw new Error("Draft not found.");
    }
    return draft;
  }

  return {
    async createSession(): Promise<SheetSession> {
      const session: SheetSession = {
        sessionId: crypto.randomUUID(),
        accessToken: crypto.randomUUID(),
        expiresAt: new Date(now().getTime() + 120 * 60 * 1000).toISOString(),
      };
      sessions.set(session.sessionId, {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
      });
      return session;
    },

    async getSession(
      sessionId: string,
      accessToken: string,
    ): Promise<SheetSessionView> {
      requireSession(sessionId, accessToken);
      return {
        sessionId,
        status: "ACTIVE",
        expiresAt: new Date(now().getTime() + 120 * 60 * 1000).toISOString(),
      };
    },

    async createDraft(
      sessionId: string,
      accessToken: string,
      request: SheetDraftCreateRequestV2,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const draft = validateDraftV2(request);
      if (draft.sessionId !== sessionId) {
        throw new DraftError(
          "invalid_draft",
          "The draft session does not match the authorized session.",
        );
      }
      if (draft.version !== 1) {
        throw new DraftError(
          "invalid_draft",
          "A new draft must start at version 1.",
        );
      }
      if (draft.baseVersion !== 1) {
        throw new DraftError(
          "invalid_draft",
          "A new draft must start at base version 1.",
        );
      }
      const key = keyOf(sessionId, draft.draftId);
      if (drafts.has(key)) {
        throw new DraftError(
          "invalid_draft",
          "A draft with this id already exists for this session.",
        );
      }
      drafts.set(key, draft);
      return draft;
    },

    async getDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      return requireOwnedDraft(sessionId, draftId);
    },

    async mutateDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftMutationRequestV2,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      const next = applyDraftMutationV2(
        current,
        request.mutation,
        request.expectedVersion,
      );
      drafts.set(keyOf(sessionId, draftId), next);
      return next;
    },

    async rerollDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftRerollRequestV2,
    ): Promise<SheetDraftRerollResponseV2> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      const result = rerollLockedDraftValuesV2(current, request.seed);
      drafts.set(keyOf(sessionId, draftId), result.draft);
      return result;
    },

    async confirmDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftConfirmRequestV2,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      const confirmed = finalizeDraftV2(current);
      drafts.set(keyOf(sessionId, draftId), confirmed);
      return confirmed;
    },
  };
}
