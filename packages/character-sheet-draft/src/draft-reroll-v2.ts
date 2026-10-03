import {
  createSeededRandom,
  stableDraftSeed,
  type SeededRandom,
} from "./reroll-random";
import { draftError } from "./errors";
import type { DraftField, DraftValue } from "./draft-schema";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import { bumpDraftVersionV2 } from "./draft-versioning-v2";

export interface DraftRerollResultV2 {
  draft: CharacterSheetDraftV2;
  rerolledKeys: string[];
}

/**
 * V2 surface-level reroll, producing the authoritative next V2 snapshot.
 *
 * Eligible Fields are exactly the locked Fields that carry an explicit
 * deterministic draw grammar: a `number` with both bounds, or a `choice` with
 * at least one declared option. Everything else — unlocked Fields, text,
 * textarea, checkbox, list, and under-bounded numbers — has no draw grammar,
 * so its authored value is preserved. Reroll never invents
 * free text or list content.
 *
 * The draw stream is deterministic: same seed + same ordered Field registry
 * reproduces the same values on every runtime. Iteration follows `draft.fields`
 * registry order, never `structure[]`, because reroll grammar belongs to
 * Fields rather than their visual placement — moving a Field must not shift
 * the deterministic stream.
 *
 * Unlike a semantic editor mutation, reroll is an explicit lifecycle action: an
 * accepted reroll ALWAYS creates a new version, even when no Field had a draw
 * grammar or the drawn value happened to equal the previous one. The version
 * transition is delegated to the 4B1 primitive `bumpDraftVersionV2`, which
 * also serves as the final canonical V2 validation gate. `baseVersion` never
 * moves and `expectedVersion` is deliberately not involved; concurrency
 * remains a transport/Worker responsibility.
 *
 * @param draft - A canonical V2 draft snapshot (assumed already valid)
 * @param seed - Stable reroll seed
 * @returns The next authoritative V2 snapshot plus the rerolled Field keys
 * @throws DraftError("draft_confirmed") when the draft is already confirmed
 */
export function rerollLockedDraftValuesV2(
  draft: CharacterSheetDraftV2,
  seed: string,
): DraftRerollResultV2 {
  assertRerollable(draft);

  const random = createSeededRandom(stableDraftSeed(seed));
  const values: Record<string, DraftValue> = { ...draft.values };
  const rerolledKeys: string[] = [];

  for (const field of draft.fields) {
    // `character_name` is display identity, never a draw target: the V2
    // contract requires a string-or-null name, so a locked bounded
    // `character_name` field must not be rerolled even if one is constructed.
    if (field.key === "character_name") {
      continue;
    }
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

  const nextDraft = bumpDraftVersionV2({
    ...draft,
    values,
    characterName: mirroredCharacterName(values, draft.characterName),
  });

  return { draft: nextDraft, rerolledKeys };
}

function assertRerollable(draft: CharacterSheetDraftV2): void {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is confirmed and read-only; it cannot be mutated or rerolled.",
    );
  }
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

/**
 * Reroll never invents a character name, so the existing mirror is carried
 * forward unless the rerolled values already hold a string `character_name`.
 * This keeps `characterName === values["character_name"] ?? null` intact.
 */
function mirroredCharacterName(
  values: Record<string, DraftValue>,
  current: string | null,
): string | null {
  const nameValue = values["character_name"];
  return typeof nameValue === "string" ? nameValue : current;
}
