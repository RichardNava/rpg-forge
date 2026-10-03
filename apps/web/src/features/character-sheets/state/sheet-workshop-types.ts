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
