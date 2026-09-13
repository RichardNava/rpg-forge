export const CHARACTER_SHEET_ARTIFACT_ERROR_CODES = [
  "invalid_artifact_identity",
  "invalid_spec",
  "storage_unavailable",
  "corrupt_spec",
  "cleanup_failed",
] as const;

export type CharacterSheetArtifactErrorCode =
  (typeof CHARACTER_SHEET_ARTIFACT_ERROR_CODES)[number];

/**
 * Typed failure for temporary character-sheet artifact storage. Codes are
 * transport-neutral: adapters map storage failures to these codes and never
 * surface provider-specific errors to the domain.
 */
export class CharacterSheetArtifactError extends Error {
  readonly code: CharacterSheetArtifactErrorCode;

  constructor(code: CharacterSheetArtifactErrorCode, message: string) {
    super(message);
    this.name = "CharacterSheetArtifactError";
    this.code = code;
  }
}

export function artifactError(
  code: CharacterSheetArtifactErrorCode,
  message: string,
): CharacterSheetArtifactError {
  return new CharacterSheetArtifactError(code, message);
}
