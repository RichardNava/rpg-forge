/**
 * Neutral identity for versioned temporary character-sheet drafts.
 *
 * Both the canonical V2 store port and the immutable R2 key layout address
 * snapshots by this opaque session/draft pair. It carries no schema version:
 * the version lives in the snapshot payload and in the `v<version>.json` key
 * segment, never in the identity.
 */
export interface CharacterSheetDraftIdentity {
  sessionId: string;
  draftId: string;
}
