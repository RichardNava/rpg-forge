import { z } from "zod";
import { draftError } from "./errors";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";

/**
 * Undo mutation — one-level server-authoritative (14.10).
 *
 * This mutation is special: it requires server-side history (the undoSourceVersion
 * stored in the D1 draft head). The domain apply function receives the draft and
 * the expectedVersion, but the actual undo logic (loading the undo source from
 * R2 and creating a new snapshot) is orchestrated by the Worker, which has
 * access to the D1 head and R2 store.
 *
 * The domain function here validates the mutation shape and applies the undo
 * to a draft that has ALREADY been restored from the undo source version.
 * This keeps the domain pure while the Worker handles the persistence orchestration.
 */
export const DraftUndoMutationV2Schema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("undo"),
  }),
]);
export type DraftUndoMutationV2 = z.infer<typeof DraftUndoMutationV2Schema>;

/**
 * Parses an unknown input into a validated undo mutation.
 */
export function parseDraftUndoMutationV2(
  input: unknown,
): DraftUndoMutationV2 {
  const result = DraftUndoMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The undo mutation is invalid."
        : `The undo mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies an undo mutation to a draft that has ALREADY been restored from the
 * undo source version (by the Worker orchestration layer).
 *
 * The Worker is responsible for:
 * 1. Reading the D1 head to get undoSourceVersion and undoConsumed
 * 2. Validating that undo is available (undoSourceVersion !== null && !undoConsumed)
 * 3. Loading the undo source snapshot from R2 via getDraftVersion
 * 4. Creating a new snapshot with version = current.version + 1 by copying the
 *    undo source's CONTENT (structure, fields, sections, values, layout)
 * 5. Calling this function to apply the undo mutation (which bumps version)
 *
 * This function only validates the undo mutation and bumps the version.
 * The actual content restoration is done by the Worker before calling this.
 */
export function applyDraftUndoWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftUndoMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  // Validate expectedVersion matches
  if (expectedVersion !== draft.version) {
    throw draftError(
      "version_conflict",
      `Expected version ${expectedVersion} but draft is at version ${draft.version}.`,
    );
  }

  // Confirmed guard
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is confirmed and read-only; it cannot be mutated.",
    );
  }

  // The Worker has already restored the content from the undo source.
  // We just need to bump the version and validate.
  const candidate: CharacterSheetDraftV2 = {
    ...draft,
    version: nextDraftVersion(draft.version),
    baseVersion: draft.baseVersion,
  };
  validateDraftV2(candidate);
  return candidate;
}