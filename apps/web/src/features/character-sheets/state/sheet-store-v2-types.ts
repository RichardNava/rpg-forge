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

export type FinalGenerationStatus = "idle" | "generating" | "ready" | "error";

export interface FinalGenerationState {
  status: FinalGenerationStatus;
  runId: string | null;
  draftVersion: number | null;
  error: SheetApiError | null;
}

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
  /** Whether server-authoritative Undo is available (14.10). */
  undoAvailable: boolean;
  /** The version that can be restored via Undo (14.10). */
  undoSourceVersion: number | null;
  /** Final-generation operational state (14.12). Never holds PDF bytes. */
  finalGeneration: FinalGenerationState;
  error: SheetApiError | null;
}

export const INITIAL_SHEET_STORE_V2_STATE: SheetStoreV2State = {
  phase: "empty",
  sessionId: null,
  accessToken: null,
  draft: null,
  saveStatus: "idle",
  workshop: {
    threatLevel: null,
    visualStyle: "medieval",
    portrait: { kind: "none" },
  },
  rerolledKeys: null,
  savedVersion: null,
  undoAvailable: false,
  undoSourceVersion: null,
  finalGeneration: { status: "idle", runId: null, draftVersion: null, error: null },
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

export type SheetStoreV2FinalGenerationOutcome =
  | { kind: "ok"; runId: string; draftVersion: number }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "not_ready" }
  | { kind: "inflight" }
  | { kind: "error"; error: SheetApiError };

export interface SheetStoreV2FinalGenerationInput {
  threat: import("./sheet-workshop-types").ThreatLevelPreference | null;
  visualStyle: import("./sheet-workshop-types").VisualStyleKey;
  instructions?: string | null;
  seed?: string;
}

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
  undo(): Promise<SheetStoreV2MutationOutcome>;
  reroll(seed: string): Promise<SheetStoreV2RerollOutcome>;
  confirm(): Promise<SheetStoreV2ConfirmOutcome>;
  generateFinalSheet(
    input: SheetStoreV2FinalGenerationInput,
  ): Promise<SheetStoreV2FinalGenerationOutcome>;
  downloadFinalPdf(): Promise<Uint8Array | null>;
  reset(): void;
}
