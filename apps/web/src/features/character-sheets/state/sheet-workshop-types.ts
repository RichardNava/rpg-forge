/**
 * Runtime-neutral workshop state types used by the V2 sheet store.
 * These describe UI/session status only — never draft content — so the store
 * stays decoupled from the draft contract.
 */
export type SheetStorePhase = "empty" | "loading" | "ready" | "error";

export type SheetDraftSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Workshop-level identity preferences. These are UX coaching inputs that guide
 * the final sheet generation; they are NOT part of the draft schema and never
 * cross the API boundary. `threatLevel` only applies to NPCs.
 */
export type ThreatLevelPreference = "very-low" | "low" | "medium" | "elite" | "legendary";

/**
 * Visual style keys for sheet rendering. Reuses the canonical enum from
 * @repo/character-sheet-generation (CanonicalVisualStyleSchema).
 */
export type VisualStyleKey =
  | "medieval"
  | "fantasy"
  | "gothic"
  | "steampunk"
  | "sci-fi"
  | "contemporary";

/**
 * Portrait source for the character image. Reuses the shared canonical
 * PortraitConfig: exactly one source is active (`none`, or an upload/url/ai
 * asset reference). Raw files, data URLs, remote URLs and prompts never
 * enter Workshop state.
 */
export type PortraitSource =
  | { kind: "none" }
  | { kind: "upload"; assetId: string }
  | { kind: "url"; assetId: string }
  | { kind: "ai"; assetId: string };

export interface WorkshopPreferences {
  threatLevel: ThreatLevelPreference | null;
  visualStyle: VisualStyleKey;
  portrait: PortraitSource;
}
