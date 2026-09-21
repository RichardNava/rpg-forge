import type {
  CharacterSheetDraft,
  DraftMutation,
} from "@repo/character-sheet-draft";
import type { SheetApiError } from "../api/sheet-api-errors";

export type SheetStorePhase = "empty" | "loading" | "ready" | "error";

export type SheetDraftSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Workshop-level identity preferences. These are UX coaching inputs that guide
 * the final sheet generation; they are NOT part of the draft schema and never
 * cross the API boundary. `characterType` is seeded from `draft.mode` whenever
 * a draft loads; `threatLevel` only applies to NPCs.
 */
export type CharacterTypePreference = "pc" | "npc";

export type ThreatLevelPreference = "common" | "veteran" | "elite" | "boss";

/**
 * Visual style keys for sheet rendering. Must match the kebab-case regex in
 * `packages/character-sheet-generation/src/authoring.ts` (`VisualStyleKeySchema`).
 */
export type VisualStyleKey =
  | "medieval-fantasy"
  | "dark-fantasy"
  | "steampunk"
  | "oriental-fantasy"
  | "retrofuturistic"
  | "classic-rpg";

/**
 * Portrait source for the character image.
 */
export type PortraitSource =
  | { kind: "upload"; dataUrl: string }
  | { kind: "url"; url: string }
  | { kind: "ai"; prompt: string }
  | { kind: "none" };

export interface WorkshopPreferences {
  characterType: CharacterTypePreference;
  threatLevel: ThreatLevelPreference | null;
  visualStyle: VisualStyleKey;
  portrait: PortraitSource;
}

export interface SheetStoreState {
  phase: SheetStorePhase;
  /** Temporary sheet session identity; access tokens are kept in memory only. */
  sessionId: string | null;
  accessToken: string | null;
  draft: CharacterSheetDraft | null;
  saveStatus: SheetDraftSaveStatus;
  workshop: WorkshopPreferences;
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
  setWorkshopPreferences(
    patch: Partial<WorkshopPreferences>,
  ): void;
  applyMutation(mutation: DraftMutation): Promise<SheetStoreMutationOutcome>;
  reroll(seed: string): Promise<SheetStoreRerollOutcome>;
  confirm(): Promise<SheetStoreConfirmOutcome>;
  reset(): void;
}
