import {
  CharacterSheetDraftSchema,
  applyDraftMutation,
  bumpDraftVersion,
  DraftError,
  type CharacterSheetDraft,
  type DraftMutation,
} from "@repo/character-sheet-draft";
import { SheetApiError } from "../api/sheet-api-errors";
import type { SheetApiClientPort } from "../api/sheet-api-client";
import {
  INITIAL_SHEET_STORE_STATE,
  type SheetStore,
  type SheetStoreConfirmOutcome,
  type SheetStoreListener,
  type SheetStoreMutationOutcome,
  type SheetStoreRerollOutcome,
  type SheetStoreState,
  type WorkshopPreferences,
} from "./sheet-store-types";

export interface SheetStoreOptions {
  api: SheetApiClientPort;
}

/**
 * Framework-independent vanilla store for the temporary character-sheet
 * authoring surface. It hydrates a draft snapshot from the rules-worker,
 * applies domain mutations with optimistic previews, and always reconciles the
 * authoritative committed snapshot from the server response (or a fresh GET
 * after a failed save). No React, no state library.
 */
export function createSheetStore(options: SheetStoreOptions): SheetStore {
  let state: SheetStoreState = { ...INITIAL_SHEET_STORE_STATE };
  const listeners = new Set<SheetStoreListener>();

  function setState(patch: Partial<SheetStoreState>): void {
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

  function workshopForDraft(mode: CharacterSheetDraft["mode"]): WorkshopPreferences {
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
    getState(): SheetStoreState {
      return state;
    },

    subscribe(listener: SheetStoreListener): () => void {
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

    async createDraft(snapshot: CharacterSheetDraft): Promise<void> {
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
      const validated = CharacterSheetDraftSchema.safeParse(snapshot);
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
      mutation: DraftMutation,
    ): Promise<SheetStoreMutationOutcome> {
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
      let pending: CharacterSheetDraft;
      try {
        pending = bumpDraftVersion(applyDraftMutation(draft, mutation));
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
          mutation,
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

    async reroll(seed: string): Promise<SheetStoreRerollOutcome> {
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
          seed,
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

    async confirm(): Promise<SheetStoreConfirmOutcome> {
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
      setState({
        saveStatus: "saving",
        error: null,
      });

      try {
        const confirmed = await options.api.confirmDraft(
          sessionId,
          accessToken,
          draft.draftId,
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
      state = { ...INITIAL_SHEET_STORE_STATE };
      emit();
    },
  };
}
