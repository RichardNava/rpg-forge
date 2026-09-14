import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import type { CharacterSheetDraft, DraftValue } from "../draft-schema";
import { draftError } from "../errors";

/**
 * Overlays the draft's edited values onto the generated `baseSpec` that owns
 * the sheet structure: pages, sections, field roster, theme, and provenance
 * stay exactly as generated, while `values` become the draft's. Draft surface
 * keys absent from the base spec are dropped (the surface is a subset of the
 * spec it was created from). The resulting spec passes the canonical schema
 * and domain validation or the writeback fails closed.
 */
export function writebackDraftToSpec(
  draft: CharacterSheetDraft,
  baseSpec: CharacterSheetSpec,
): CharacterSheetSpec {
  const fieldIds = new Set(baseSpec.fields.map((field) => field.id));
  const values: Record<string, DraftValue> = {};
  for (const [key, value] of Object.entries(draft.values)) {
    if (fieldIds.has(key)) {
      values[key] = value;
    }
  }

  const next: CharacterSheetSpec = { ...baseSpec, values };
  const parsed = CharacterSheetSpecSchema.safeParse(next);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw draftError(
      "writeback_invalid",
      first === undefined
        ? "The writeback spec is invalid."
        : `The writeback spec is invalid: ${first.message}`,
    );
  }
  const domain = validateCharacterSheetSpecDomain(parsed.data);
  if (!domain.valid) {
    throw draftError(
      "writeback_invalid",
      `The writeback spec fails domain validation: ${domain.issues
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  return parsed.data;
}
