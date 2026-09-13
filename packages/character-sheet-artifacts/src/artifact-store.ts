import type { CharacterSheetSpec } from "@repo/character-sheet-schema";

export interface CharacterSheetArtifactIdentity {
  sessionId: string;
  runId: string;
}

export interface PutRunArtifactsInput extends CharacterSheetArtifactIdentity {
  spec: CharacterSheetSpec;
  pdfBytes: Uint8Array;
}

/**
 * Port for temporary character-sheet run artifacts. The port deliberately has
 * no generic read/write-by-key method: keys are derived from opaque identities
 * and never become a user-facing, arbitrary-key API. Missing reads return null
 * (not-found); corruption and storage failures throw typed errors.
 */
export interface CharacterSheetArtifactStore {
  putRunArtifacts(input: PutRunArtifactsInput): Promise<void>;
  getSpec(
    identity: CharacterSheetArtifactIdentity,
  ): Promise<CharacterSheetSpec | null>;
  getPdfBytes(
    identity: CharacterSheetArtifactIdentity,
  ): Promise<Uint8Array | null>;
  deleteRunArtifacts(identity: CharacterSheetArtifactIdentity): Promise<void>;
  deleteSessionArtifacts(sessionId: string): Promise<void>;
}
