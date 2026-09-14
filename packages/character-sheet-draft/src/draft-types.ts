import type { DraftSource } from "./draft-schema";
import type { CharacterSheetDraft, DraftField } from "./draft-schema";

export type { CharacterSheetDraft, DraftField } from "./draft-schema";
export type { DraftSource, DraftValue } from "./draft-schema";

/** Snapshot alias: every persisted draft is an immutable, versioned snapshot. */
export type DraftSnapshot = CharacterSheetDraft;

/** Immutable provenance back to the generated run the draft was created from. */
export interface DraftBase {
  source: DraftSource;
}
