import { draftError } from "./errors";
import {
  parseLegacyCharacterSheetDraftV1,
  migrateCharacterSheetDraftV1ToV2,
} from "./draft-migration-v1-to-v2";
import {
  validateDraftV2,
  CharacterSheetDraftV2Schema,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";

/**
 * Parses untrusted input as a canonical V2 draft.
 * Dispatches explicitly on schemaVersion:
 * - "1" -> strict V1 parse -> migrate -> validate V2
 * - "2" -> strict V2 parse
 * Any other value is rejected.
 * No fallback, no auto-repair.
 */
export function parseCanonicalCharacterSheetDraft(
  input: unknown,
): CharacterSheetDraftV2 {
  if (!input || typeof input !== "object") {
    throw draftError("invalid_draft", "Input is not an object.");
  }
  const obj = input as Record<string, unknown>;
  const schemaVersion = obj.schemaVersion;

  if (schemaVersion === "1") {
    const v1 = parseLegacyCharacterSheetDraftV1(input);
    return migrateCharacterSheetDraftV1ToV2(v1);
  }

  if (schemaVersion === "2") {
    return validateDraftV2(input);
  }

  throw draftError(
    "invalid_draft",
    `Unsupported schemaVersion: ${String(schemaVersion)}`,
  );
}
