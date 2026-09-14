import type { CharacterSheetDraft } from "./draft-schema";
import { draftError } from "./errors";

/**
 * Versioned draft snapshots are immutable: every save writes a new `version`
 * under a distinct key, and the storage layer never mutates an old snapshot.
 * The first snapshot is `version = 1`; `baseVersion` records which snapshot
 * started the draft so later writers can report "created from v<baseVersion>".
 */
export function nextDraftVersion(current: number): number {
  if (!Number.isInteger(current) || current < 1) {
    throw draftError(
      "invalid_draft",
      "A draft version must be a positive integer.",
    );
  }
  return current + 1;
}

/** Returns a new snapshot with the version bumped by one, base version intact. */
export function bumpDraftVersion(
  draft: CharacterSheetDraft,
): CharacterSheetDraft {
  return { ...draft, version: nextDraftVersion(draft.version) };
}

/** First snapshot of a draft: version 1, reusing the supplied run provenance. */
export function initialDraftVersion(
  draft: Omit<CharacterSheetDraft, "version" | "baseVersion">,
): CharacterSheetDraft {
  return {
    ...draft,
    baseVersion: 1,
    version: 1,
  };
}
