import type { CharacterSheetDraft } from "./draft-schema";
import { draftError } from "./errors";
import { bumpDraftVersion } from "./versioning";

/**
 * Terminal confirmation of an editable draft. Confirmation is a pure,
 * deterministic transition that produces a new authoritative version with a
 * `confirmed` lifecycle marker and does **not** reroll any values: the surface
 * and every value carry over unchanged, only the version bumps (so the
 * confirmed snapshot stays a valid immutable, deterministic draft).
 *
 * A confirmed draft is read-only forever:
 * - `applyDraftMutation` rejects it (`draft_confirmed`);
 * - `rerollLockedDraftValues` rejects it (`draft_confirmed`);
 * - the worker confirm route is the one terminal transition, and any mutation
 *   or reroll that reaches a confirmed head fails with the same code.
 *
 * Confirming a draft that is already confirmed is an idempotence error
 * (`draft_confirmed`) rather than a silent no-op, so clients can never
 * accidentally downgrade or double-save a confirmed snapshot.
 */
export function finalizeDraft(
  draft: CharacterSheetDraft,
): CharacterSheetDraft {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is already confirmed and is read-only forever.",
    );
  }
  return {
    ...bumpDraftVersion(draft),
    confirmed: true,
  };
}

/**
 * Mutation/reroll guard for any surface that must stay editable. Throws
 * `draft_confirmed` when the draft has already reached its terminal state.
 */
export function assertDraftEditable(draft: CharacterSheetDraft): void {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is confirmed and read-only; it cannot be mutated or rerolled.",
    );
  }
}
