import {
  CharacterSheetDraftV2Schema,
  DraftError,
  applyDraftMutationV2,
  type CharacterSheetDraftV2,
  type DraftMutationV2,
} from "@repo/character-sheet-draft";
import { SheetApiError } from "../api/sheet-api-errors";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";
import {
  INITIAL_SHEET_STORE_V2_STATE,
  type SheetStoreV2,
  type SheetStoreV2ConfirmOutcome,
  type SheetStoreV2Listener,
  type SheetStoreV2MutationOutcome,
  type SheetStoreV2RerollOutcome,
  type SheetStoreV2State,
  type WorkshopPreferences,
} from "./sheet-store-v2-types";

export interface SheetStoreV2Options {
  api: SheetApiClientV2Port;
}

/**
 * Framework-independent vanilla store for the parallel V2 authoring surface.
 * It mirrors the proven V1 store lifecycle with two deliberate differences:
 * optimistic previews run through `applyDraftMutationV2` (which owns version
 * production, so the store never bumps), and every post-create request carries
 * the `expectedVersion` captured from the locally authoritative snapshot
 * before the optimistic change.
 */
export function createSheetStoreV2(options: SheetStoreV2Options): SheetStoreV2 {
  let state: SheetStoreV2State = { ...INITIAL_SHEET_STORE_V2_STATE };
  const listeners = new Set<SheetStoreV2Listener>();

  function setState(patch: Partial<SheetStoreV2State>): void {
    state = { ...state, ...patch };
    emit();
  }

  function emit(): void {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function hasSession(): boolean {
    return (
      state.phase === "ready" &&
      state.sessionId !== null &&
      state.accessToken !== null
    );
  }

  function toSheetApiError(error: unknown): SheetApiError {
    if (error instanceof SheetApiError) {
      return error;
    }
    if (error instanceof Error) {
      return new SheetApiError("INTERNAL_ERROR", error.message);
    }
    return new SheetApiError(
      "INTERNAL_ERROR",
      "The character-sheet store failed unexpectedly.",
    );
  }

  function workshopForDraft(
    mode: CharacterSheetDraftV2["mode"],
  ): WorkshopPreferences {
    return {
      characterType: mode,
      threatLevel: null,
      visualStyle: "medieval-fantasy",
      portrait: { kind: "none" },
    };
  }

  async function reconcile(): Promise<void> {
    const { sessionId, accessToken } = state;
    const draft = state.draft;
    if (sessionId === null || accessToken === null || draft === null) {
      return;
    }
    try {
      const fresh = await options.api.getDraft(
        sessionId,
        accessToken,
        draft.draftId,
      );
      setState({
        draft: fresh,
        saveStatus: "saved",
        savedVersion: fresh.version,
        phase: "ready",
      });
    } catch {
      // Keep the error state; the outstanding error already tells the caller.
    }
  }

  return {
    getState(): SheetStoreV2State {
      return state;
    },

    subscribe(listener: SheetStoreV2Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async startSession(turnstileToken: string): Promise<void> {
      setState({ phase: "loading", error: null });
      try {
        const session = await options.api.createSession(turnstileToken);
        setState({
          phase: "ready",
          sessionId: session.sessionId,
          accessToken: session.accessToken,
          error: null,
        });
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ phase: "error", error: sheetError });
        throw sheetError;
      }
    },

    attachSession(sessionId: string, accessToken: string): void {
      setState({
        phase: "ready",
        sessionId,
        accessToken,
        error: null,
      });
    },

    async hydrate(draftId: string): Promise<void> {
      const { sessionId, accessToken } = state;
      if (sessionId === null || accessToken === null) {
        const error = new SheetApiError(
          "INVALID_REQUEST",
          "Attach a sheet session before hydrating a draft.",
          400,
        );
        setState({ phase: "error", error });
        throw error;
      }
      setState({ phase: "loading", error: null });
      try {
        const draft = await options.api.getDraft(
          sessionId,
          accessToken,
          draftId,
        );
        setState({
          phase: "ready",
          draft,
          saveStatus: "idle",
          savedVersion: draft.version,
          workshop: workshopForDraft(draft.mode),
          rerolledKeys: null,
          error: null,
        });
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ phase: "error", error: sheetError });
        throw sheetError;
      }
    },

    async createDraft(snapshot: CharacterSheetDraftV2): Promise<void> {
      const { sessionId, accessToken } = state;
      if (sessionId === null || accessToken === null) {
        const error = new SheetApiError(
          "INVALID_REQUEST",
          "Attach a sheet session before creating a draft.",
          400,
        );
        setState({ phase: "error", error });
        throw error;
      }
      const validated = CharacterSheetDraftV2Schema.safeParse(snapshot);
      if (!validated.success) {
        const error = new SheetApiError(
          "SHEET_DRAFT_INVALID",
          "The draft is invalid: check the snapshot before creating it.",
          400,
        );
        setState({ phase: "error", error });
        throw error;
      }
      setState({ phase: "loading", error: null });
      try {
        const draft = await options.api.createDraft(
          sessionId,
          accessToken,
          validated.data,
        );
        setState({
          phase: "ready",
          draft,
          saveStatus: "saved",
          savedVersion: draft.version,
          workshop: workshopForDraft(draft.mode),
          rerolledKeys: null,
          error: null,
        });
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ phase: "error", error: sheetError });
        throw sheetError;
      }
    },

    setWorkshopPreferences(patch: Partial<WorkshopPreferences>): void {
      setState({ workshop: { ...state.workshop, ...patch } });
    },

    async applyMutation(
      mutation: DraftMutationV2,
    ): Promise<SheetStoreV2MutationOutcome> {
      if (
        !hasSession() ||
        state.draft === null ||
        state.sessionId === null ||
        state.accessToken === null
      ) {
        return { kind: "not_ready" };
      }
      if (state.saveStatus === "saving") {
        return { kind: "inflight" };
      }

      const { sessionId, accessToken, draft } = state;
      const expectedVersion = draft.version;
      let pending: CharacterSheetDraftV2;
      try {
        pending = applyDraftMutationV2(draft, mutation, expectedVersion);
      } catch (error) {
        if (error instanceof DraftError) {
          return { kind: "rejected", code: error.code, message: error.message };
        }
        return {
          kind: "rejected",
          code: "INTERNAL_ERROR",
          message: "The mutation could not be applied.",
        };
      }

      setState({
        draft: pending,
        saveStatus: "saving",
        error: null,
        rerolledKeys: null,
      });

      try {
        const committed = await options.api.mutateDraft(
          sessionId,
          accessToken,
          draft.draftId,
          { expectedVersion, mutation },
        );
        setState({
          draft: committed,
          saveStatus: "saved",
          savedVersion: committed.version,
          error: null,
        });
        return { kind: "ok", draft: committed };
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ saveStatus: "error", error: sheetError });
        await reconcile();
        return { kind: "error", error: sheetError };
      }
    },

    async reroll(seed: string): Promise<SheetStoreV2RerollOutcome> {
      if (
        !hasSession() ||
        state.draft === null ||
        state.sessionId === null ||
        state.accessToken === null
      ) {
        return { kind: "not_ready" };
      }
      if (state.saveStatus === "saving") {
        return { kind: "inflight" };
      }

      const { sessionId, accessToken, draft } = state;
      const expectedVersion = draft.version;
      setState({
        saveStatus: "saving",
        error: null,
        rerolledKeys: null,
      });

      try {
        const result = await options.api.rerollDraft(
          sessionId,
          accessToken,
          draft.draftId,
          { expectedVersion, seed },
        );
        setState({
          draft: result.draft,
          saveStatus: "saved",
          savedVersion: result.draft.version,
          rerolledKeys: result.rerolledKeys,
          error: null,
        });
        return {
          kind: "ok",
          draft: result.draft,
          rerolledKeys: result.rerolledKeys,
        };
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ saveStatus: "error", error: sheetError });
        await reconcile();
        return { kind: "error", error: sheetError };
      }
    },

    async confirm(): Promise<SheetStoreV2ConfirmOutcome> {
      if (
        !hasSession() ||
        state.draft === null ||
        state.sessionId === null ||
        state.accessToken === null
      ) {
        return { kind: "not_ready" };
      }
      if (state.saveStatus === "saving") {
        return { kind: "inflight" };
      }

      const { sessionId, accessToken, draft } = state;
      const expectedVersion = draft.version;
      setState({
        saveStatus: "saving",
        error: null,
      });

      try {
        const confirmed = await options.api.confirmDraft(
          sessionId,
          accessToken,
          draft.draftId,
          { expectedVersion },
        );
        setState({
          draft: confirmed,
          saveStatus: "saved",
          savedVersion: confirmed.version,
          error: null,
        });
        return { kind: "ok", draft: confirmed };
      } catch (error) {
        const sheetError = toSheetApiError(error);
        setState({ saveStatus: "error", error: sheetError });
        await reconcile();
        return { kind: "error", error: sheetError };
      }
    },

    reset(): void {
      state = { ...INITIAL_SHEET_STORE_V2_STATE };
      emit();
    },
  };
}
