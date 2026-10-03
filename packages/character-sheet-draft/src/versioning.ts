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
