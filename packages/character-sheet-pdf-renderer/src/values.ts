import type { CharacterSheetField } from "@repo/character-sheet-schema";
import { CharacterSheetPdfRenderError } from "./errors";

/** Structural copy of the spec's values entry, kept local to avoid a rules-context dependency. */
export type FieldSpecValue =
  | string
  | number
  | boolean
  | null
  | FieldSpecValue[]
  | { [key: string]: FieldSpecValue };
export type FieldValueMap = Readonly<Record<string, FieldSpecValue>>;

/**
 * Deterministic value resolution. Also the single authoritative gate for which
 * field types the renderer can represent:
 *
 * - text, number, textarea: editable controls;
 * - calculated: read-only control whose value comes from the snapshot (the
 *   renderer never evaluates formulas);
 * - image/checkbox/radio/select/multiselect/rating/resource/list/table: not
 *   part of the Phase 14.5 generated surface and fail visibly with
 *   `unsupported_field_type` instead of rendering a wrong control.
 */

export const SUPPORTED_EDITABLE_TYPES = ["text", "number", "textarea"] as const;
export const SUPPORTED_CALCULATED_TYPE = "calculated" as const;

export const PDF_FIELD_PREFIX = "rpgforge" as const;

export function pdfFieldNameFor(fieldId: string): string {
  return `${PDF_FIELD_PREFIX}.${fieldId}`;
}

export type FieldKind = "editable" | "read-only" | "unsupported";

export function fieldKind(field: CharacterSheetField): FieldKind {
  if (field.type === "calculated") {
    return "read-only";
  }
  if (
    SUPPORTED_EDITABLE_TYPES.includes(
      field.type as (typeof SUPPORTED_EDITABLE_TYPES)[number],
    )
  ) {
    return "editable";
  }
  return "unsupported";
}

export interface ResolvedFieldValue {
  /** The visible text on the control, or null for a deliberately blank control. */
  readonly text: string | null;
  /** True for controls the user can edit. */
  readonly editable: boolean;
}

/**
 * Resolves the value for a field from the spec. Blank is expressed by leaving
 * the control empty (no rendered placeholder, no fabricated zero or dash).
 *
 * Type mismatches (e.g. a number in a text field value slot) fail visibly with
 * `unsupported_field_value`; values are rendered losslessly with String(v).
 */
export function resolveFieldValue(
  field: CharacterSheetField,
  values: FieldValueMap,
): ResolvedFieldValue {
  const raw = values[field.id];

  switch (field.type) {
    case "text":
    case "textarea":
      return {
        text:
          raw === undefined || raw === null ? null : stringValue(field, raw),
        editable: true,
      };
    case "number":
      return {
        text:
          raw === undefined || raw === null ? null : numericValue(field, raw),
        editable: true,
      };
    case "calculated":
      return {
        text:
          raw === undefined || raw === null
            ? null
            : calculatedValue(field, raw),
        editable: false,
      };
    default:
      throw new CharacterSheetPdfRenderError(
        "unsupported_field_type",
        `Field "${field.id}" has type "${field.type}", which the deterministic ` +
          `PDF renderer does not support yet.`,
      );
  }
}

function stringValue(field: CharacterSheetField, raw: FieldSpecValue): string {
  if (typeof raw === "string") {
    return raw;
  }
  throw new CharacterSheetPdfRenderError(
    "unsupported_field_value",
    `Field "${field.id}" (${field.type}) expected a string value but ` +
      `received the JSON value ${JSON.stringify(raw)}.`,
  );
}

function numericValue(field: CharacterSheetField, raw: FieldSpecValue): string {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  throw new CharacterSheetPdfRenderError(
    "unsupported_field_value",
    `Field "${field.id}" (number) expected a finite number but received ` +
      `the JSON value ${JSON.stringify(raw)}.`,
  );
}

function calculatedValue(
  field: CharacterSheetField,
  raw: FieldSpecValue,
): string {
  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
      return String(raw);
    default:
      if (raw === null) {
        return "";
      }
      throw new CharacterSheetPdfRenderError(
        "unsupported_field_value",
        `Calculated field "${field.id}" has a non-scalar value ` +
          `${JSON.stringify(raw)}; the renderer only reflects the snapshot.`,
      );
  }
}
