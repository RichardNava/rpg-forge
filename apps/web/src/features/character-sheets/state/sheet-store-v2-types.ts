import type {
  CharacterSheetDraftV2,
  DraftMutationV2,
} from "@repo/character-sheet-draft";
import type { SheetApiError } from "../api/sheet-api-errors";
import type {
  SheetDraftSaveStatus,
  SheetStorePhase,
  WorkshopPreferences,
} from "./sheet-workshop-types";

export type { WorkshopPreferences } from "./sheet-workshop-types";

export interface SheetStoreV2State {
  phase: SheetStorePhase;
  /** Temporary sheet session identity; access tokens are kept in memory only. */
  sessionId: string | null;
  accessToken: string | null;
  draft: CharacterSheetDraftV2 | null;
  saveStatus: SheetDraftSaveStatus;
  workshop: WorkshopPreferences;
  /** Keys redrawn by the last reroll; null when no reroll has completed. */
  rerolledKeys: string[] | null;
  /** The last version the rules-worker acknowledged. */
  savedVersion: number | null;
  error: SheetApiError | null;
}

export const INITIAL_SHEET_STORE_V2_STATE: SheetStoreV2State = {
  phase: "empty",
  sessionId: null,
  accessToken: null,
  draft: null,
  saveStatus: "idle",
  workshop: {
    characterType: "pc",
    threatLevel: null,
    visualStyle: "medieval-fantasy",
    portrait: { kind: "none" },
  },
  rerolledKeys: null,
  savedVersion: null,
  error: null,
};

export type SheetStoreV2Listener = (state: SheetStoreV2State) => void;

export type SheetStoreV2MutationOutcome =
  | { kind: "ok"; draft: CharacterSheetDraftV2 }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export type SheetStoreV2RerollOutcome =
  | {
      kind: "ok";
      draft: CharacterSheetDraftV2;
      rerolledKeys: string[];
    }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export type SheetStoreV2ConfirmOutcome =
  | { kind: "ok"; draft: CharacterSheetDraftV2 }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export interface SheetStoreV2 {
  getState(): SheetStoreV2State;
  subscribe(listener: SheetStoreV2Listener): () => void;
  startSession(turnstileToken: string): Promise<void>;
  attachSession(sessionId: string, accessToken: string): void;
  hydrate(draftId: string): Promise<void>;
  createDraft(snapshot: CharacterSheetDraftV2): Promise<void>;
  setWorkshopPreferences(patch: Partial<WorkshopPreferences>): void;
  applyMutation(
    mutation: DraftMutationV2,
  ): Promise<SheetStoreV2MutationOutcome>;
  reroll(seed: string): Promise<SheetStoreV2RerollOutcome>;
  confirm(): Promise<SheetStoreV2ConfirmOutcome>;
  reset(): void;
}
