import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";

/**
 * A V2 draft body that has not been versioned yet. The producer is
 * responsible for supplying an already-complete canonical structural snapshot
 * (`fields[]`, `sections[]`, `structure[]`); this primitive does not infer,
 * migrate, or repair structure.
 */
export type InitialCharacterSheetDraftV2 = Omit<
  CharacterSheetDraftV2,
  "version" | "baseVersion"
>;

/**
 * The first snapshot of a draft.
 *
 * Assigns `version = 1` and `baseVersion = 1` and preserves every other
 * supplied lifecycle/content property as given (including `confirmed`; whether
 * creation may set it is a transport/create-policy concern, not versioning).
 * The composed candidate is validated with `validateDraftV2` as a GATE and the
 * candidate itself is returned, so collection references are preserved and the
 * input is never mutated. Malformed V2 input is rejected, never repaired.
 *
 * @throws DraftError("invalid_draft") when the candidate is not valid V2
 */
export function initialDraftVersionV2(
  draft: InitialCharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  const candidate: CharacterSheetDraftV2 = {
    ...draft,
    baseVersion: 1,
    version: 1,
  };
  validateDraftV2(candidate);
  return candidate;
}

/**
 * A generic version transition.
 *
 * Increments `version` exactly once through `nextDraftVersion` (so malformed
 * versions are rejected with `invalid_draft` by that single owner) and leaves
 * `baseVersion` untouched. Every other property is carried over unchanged, and
 * `confirmed` is preserved: this is a generic snapshot helper, not an
 * editability gate. Confirmed immutability belongs to the mutation, reroll and
 * finalization APIs.
 *
 * No `expectedVersion` is involved; concurrency policy belongs to the mutation
 * and head-commit layers.
 *
 * @throws DraftError("invalid_draft") when the version is not a positive
 * integer, or when the bumped candidate is not valid V2
 */
export function bumpDraftVersionV2(
  draft: CharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  const candidate: CharacterSheetDraftV2 = {
    ...draft,
    version: nextDraftVersion(draft.version),
    baseVersion: draft.baseVersion,
  };
  validateDraftV2(candidate);
  return candidate;
}
