import {
  CharacterSheetSpecSchema,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import { artifactError } from "./errors.js";

/**
 * Serializes a spec for storage. The spec is re-validated against the shared
 * schema so no adapter can persist an object that would fail on read.
 */
export function serializeSpec(spec: CharacterSheetSpec): string {
  const result = CharacterSheetSpecSchema.safeParse(spec);
  if (!result.success) {
    throw artifactError(
      "invalid_spec",
      "Character sheet spec failed validation.",
    );
  }
  return JSON.stringify(result.data);
}

/**
 * Parses a stored spec. Failures map to corrupt_spec (storage corruption or a
 * schema contract change) and never surface partial data.
 */
export function parseStoredSpec(payload: string): CharacterSheetSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw artifactError(
      "corrupt_spec",
      "Stored character sheet spec is not valid JSON.",
    );
  }
  const result = CharacterSheetSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw artifactError(
      "corrupt_spec",
      "Stored character sheet spec failed validation.",
    );
  }
  return result.data;
}
