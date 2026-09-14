import type {
  CharacterSheetDraft,
  DraftField,
  DraftValue,
} from "./draft-schema";
import {
  MAX_DRAFT_SURFACE_FIELDS,
  MAX_DRAFT_VALUES_FIELDS,
} from "./draft-schema";
import { draftError } from "./errors";

/** Ordered canonical keys of the draft surface. */
export function surfaceKeys(draft: CharacterSheetDraft): string[] {
  return draft.fields.map((field) => field.key);
}

export function mustBeWithinDraftSurface(
  draft: CharacterSheetDraft,
  key: string,
): boolean {
  return draft.fields.some((field) => field.key === key);
}

export function findDraftField(
  draft: CharacterSheetDraft,
  key: string,
): DraftField | undefined {
  return draft.fields.find((field) => field.key === key);
}

export function assertDraftFieldExists(
  draft: CharacterSheetDraft,
  key: string,
): DraftField {
  const field = findDraftField(draft, key);
  if (field === undefined) {
    throw draftError(
      "surface_out_of_bounds",
      `Draft field "${key}" is outside the editable surface.`,
    );
  }
  return field;
}

export function countDraftValues(draft: CharacterSheetDraft): number {
  return Object.keys(draft.values).length;
}

/**
 * Load-time safety net: returns a copy of the draft whose values reference
 * only surface keys, bounded to the values budget. It never repairs values or
 * drops in-bounds entries that fail per-field typing; typed edits are enforced
 * at mutation time and normalized storage corruption surfaces as
 * `corrupt_draft` on read instead.
 */
export function pruneSurfaceToDraftBounds(
  draft: CharacterSheetDraft,
): CharacterSheetDraft {
  const fieldKeys = new Set(surfaceKeys(draft));
  const values: Record<string, DraftValue> = {};
  for (const [key, value] of Object.entries(draft.values)) {
    if (
      fieldKeys.has(key) &&
      Object.keys(values).length < MAX_DRAFT_VALUES_FIELDS
    ) {
      values[key] = value;
    }
  }
  return { ...draft, values };
}

export function assertDraftWithinBounds(draft: CharacterSheetDraft): void {
  if (draft.fields.length > MAX_DRAFT_SURFACE_FIELDS) {
    throw draftError(
      "surface_out_of_bounds",
      `A draft surface may contain at most ${MAX_DRAFT_SURFACE_FIELDS} fields.`,
    );
  }
  if (Object.keys(draft.values).length > MAX_DRAFT_VALUES_FIELDS) {
    throw draftError(
      "surface_out_of_bounds",
      `A draft may carry at most ${MAX_DRAFT_VALUES_FIELDS} values.`,
    );
  }
  for (const key of Object.keys(draft.values)) {
    if (!mustBeWithinDraftSurface(draft, key)) {
      throw draftError(
        "surface_out_of_bounds",
        `Draft value "${key}" is outside the editable surface.`,
      );
    }
  }
}
