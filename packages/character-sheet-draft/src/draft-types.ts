import type { DraftSource } from "./draft-schema.js";
import type { CharacterSheetDraft, DraftField } from "./draft-schema.js";

export type { CharacterSheetDraft, DraftField } from "./draft-schema.js";
export type { DraftSource, DraftValue } from "./draft-schema.js";

/** Snapshot alias: every persisted draft is an immutable, versioned snapshot. */
export type DraftSnapshot = CharacterSheetDraft;

/** Immutable provenance back to the generated run the draft was created from. */
export interface DraftBase {
  source: DraftSource;
}
