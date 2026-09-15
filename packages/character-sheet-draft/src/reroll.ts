import type {
  CharacterSheetDraft,
  DraftField,
  DraftValue,
} from "./draft-schema";
import {
  createSeededRandom,
  stableDraftSeed,
  type SeededRandom,
} from "./reroll-random";
import { assertDraftEditable } from "./finalize";

export interface DraftRerollResult {
  draft: CharacterSheetDraft;
  rerolledKeys: string[];
}

/**
 * Surface-level reroll. Only read-locked fields with a draw grammar change:
 * number fields bounded on both ends draw inside `[min, max]` and choice
 * fields pick a declared option. Text, textarea and checkbox fields have no
 * draw grammar, so a locked field of those kinds keeps its current value (the
 * generator never invents free text). Unlocked fields always keep their
 * authored value. The same seed over the same ordered snapshot reproduces the
 * same values on every runtime.
 */
export function rerollLockedDraftValues(
  draft: CharacterSheetDraft,
  seed: string,
): DraftRerollResult {
  assertDraftEditable(draft);
  const random = createSeededRandom(stableDraftSeed(seed));
  const values = { ...draft.values };
  const rerolledKeys: string[] = [];
  for (const field of draft.fields) {
    if (!field.locked) {
      continue;
    }
    const next = drawRerollValue(field, random);
    if (next === undefined) {
      continue;
    }
    values[field.key] = next;
    rerolledKeys.push(field.key);
  }
  const characterName =
    typeof values["character_name"] === "string"
      ? values["character_name"]
      : draft.characterName;
  return { draft: { ...draft, values, characterName }, rerolledKeys };
}

function drawRerollValue(
  field: DraftField,
  random: SeededRandom,
): DraftValue | undefined {
  if (
    field.type === "number" &&
    field.min !== undefined &&
    field.max !== undefined
  ) {
    const span = field.max - field.min;
    return field.min + random() * span;
  }
  if (
    field.type === "choice" &&
    field.options !== undefined &&
    field.options.length > 0
  ) {
    const index = Math.floor(random() * field.options.length);
    return field.options[index] ?? field.options[0];
  }
  return undefined;
}
