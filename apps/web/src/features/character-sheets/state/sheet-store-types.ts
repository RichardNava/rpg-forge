import type {
  CharacterSheetDraft,
  DraftMutation,
} from "@repo/character-sheet-draft";
import type { SheetApiError } from "../api/sheet-api-errors";

export type SheetStorePhase = "empty" | "loading" | "ready" | "error";

export type SheetDraftSaveStatus = "idle" | "saving" | "saved" | "error";

export interface SheetStoreState {
  phase: SheetStorePhase;
  /** Temporary sheet session identity; access tokens are kept in memory only. */
  sessionId: string | null;
  accessToken: string | null;
  draft: CharacterSheetDraft | null;
  saveStatus: SheetDraftSaveStatus;
  /** Keys redrawn by the last reroll; null when no reroll has completed. */
  rerolledKeys: string[] | null;
  /** The last version the rules-worker acknowledged. */
  savedVersion: number | null;
  error: SheetApiError | null;
}

export const INITIAL_SHEET_STORE_STATE: SheetStoreState = {
  phase: "empty",
  sessionId: null,
  accessToken: null,
  draft: null,
  saveStatus: "idle",
  rerolledKeys: null,
  savedVersion: null,
  error: null,
};

export type SheetStoreListener = (state: SheetStoreState) => void;

export type SheetStoreMutationOutcome =
  | { kind: "ok"; draft: CharacterSheetDraft }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export type SheetStoreRerollOutcome =
  | { kind: "ok"; draft: CharacterSheetDraft; rerolledKeys: string[] }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export type SheetStoreConfirmOutcome =
  | { kind: "ok"; draft: CharacterSheetDraft }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export interface SheetStore {
  getState(): SheetStoreState;
  subscribe(listener: SheetStoreListener): () => void;
  startSession(turnstileToken: string): Promise<void>;
  attachSession(sessionId: string, accessToken: string): void;
  hydrate(draftId: string): Promise<void>;
  createDraft(snapshot: CharacterSheetDraft): Promise<void>;
  applyMutation(mutation: DraftMutation): Promise<SheetStoreMutationOutcome>;
  reroll(seed: string): Promise<SheetStoreRerollOutcome>;
  confirm(): Promise<SheetStoreConfirmOutcome>;
  reset(): void;
}
