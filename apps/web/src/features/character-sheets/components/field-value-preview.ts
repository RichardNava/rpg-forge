import type { DraftField, DraftValue } from "@repo/character-sheet-draft";

/**
 * Shared value renderer for sheet previews. Operates only on the neutral
 * `DraftField`/`DraftValue` primitives of the draft contract.
 */
export function previewValue(field: DraftField, value: DraftValue): string {
  if (value === null || value === undefined) return "";
  if (field.type === "checkbox") return value === true ? "✓" : "";
  if (field.type === "list" && Array.isArray(value)) return value.join(" · ");
  return String(value);
}
