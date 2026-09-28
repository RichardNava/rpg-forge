import { draftError } from "./errors";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import { bumpDraftVersionV2 } from "./draft-versioning-v2";

/**
 * V2 terminal confirmation.
 *
 * Confirmation is a pure, deterministic lifecycle transition that produces the
 * next authoritative version carrying the `confirmed` marker. It deliberately
 * does **not** touch content: no reroll, no value clearing, no Field or
 * Section edits, no reordering, no `characterName` recomputation. Only
 * `confirmed` and `version` change; every collection is carried over by
 * reference, and `baseVersion` never moves.
 *
 * The version transition is delegated to the 4B1 primitive
 * `bumpDraftVersionV2`, which also serves as the canonical V2 validation gate
 * for the final confirmed candidate. `expectedVersion` is deliberately absent:
 * concurrency around confirmation belongs to the Worker/head-commit boundary,
 * and this is a pure domain transition.
 *
 * A confirmed draft is read-only forever:
 * - `applyDraftMutationV2` rejects it (`draft_confirmed`);
 * - `rerollLockedDraftValuesV2` rejects it (`draft_confirmed`);
 * - this function rejects it (`draft_confirmed`).
 *
 * Confirming an already-confirmed draft is an idempotence ERROR rather than a
 * silent no-op or a further version, so a client can never accidentally
 * downgrade or double-save a confirmed snapshot.
 *
 * @param draft - An editable canonical V2 draft snapshot
 * @returns The confirmed V2 snapshot at the next version
 * @throws DraftError("draft_confirmed") when the draft is already confirmed
 */
export function finalizeDraftV2(
  draft: CharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is already confirmed and is read-only forever.",
    );
  }
  return bumpDraftVersionV2({
    ...draft,
    confirmed: true,
  });
}
