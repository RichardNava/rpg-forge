import type { CharacterSheetDraft } from "./draft-schema";

export interface CharacterSheetDraftIdentity {
  sessionId: string;
  draftId: string;
}

/**
 * Port for versioned temporary character-sheet drafts. The port deliberately
 * has no arbitrary-key read/write method: keys are derived from opaque
 * identities plus the snapshot version and never become a user-facing,
 * arbitrary-key API. `putDraft` writes one immutable snapshot per call; the
 * caller bumps the version between saves. Missing reads return null
 * (not-found); corruption and storage failures throw typed `DraftError`s.
 */
export interface CharacterSheetDraftStore {
  putDraft(draft: CharacterSheetDraft): Promise<void>;
  getDraftVersion(
    identity: CharacterSheetDraftIdentity,
    version: number,
  ): Promise<CharacterSheetDraft | null>;
  getLatestDraft(
    identity: CharacterSheetDraftIdentity,
  ): Promise<CharacterSheetDraft | null>;
  listDraftVersions(identity: CharacterSheetDraftIdentity): Promise<number[]>;
  deleteDraft(identity: CharacterSheetDraftIdentity): Promise<void>;
}
