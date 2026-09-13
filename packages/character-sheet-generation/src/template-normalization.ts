import type { CharacterSheetTemplate } from "@repo/character-sheet-template";
import type { CharacterSheetAuthoringMode } from "./authoring.js";
import {
  canonicalizeFieldLabel,
  GenerationConflictSchema,
  SourceResolvedFieldSchema,
  type GenerationConflict,
  type SheetFieldSourceProvenance,
  type SourceResolvedField,
} from "./source-resolution.js";
import { mergeProvenance } from "./source-merge.js";

const templateProvenance: SheetFieldSourceProvenance = {
  origins: ["sheet-template"],
};

function makeConflict(
  code: GenerationConflict["code"],
  canonicalKey: SourceResolvedField["canonicalKey"] | null,
  message: string,
  sourceLabels: readonly string[],
): GenerationConflict {
  return GenerationConflictSchema.parse({
    code,
    canonicalKey,
    message,
    sourceLabels: sourceLabels.filter(
      (label, index, all) => all.indexOf(label) === index,
    ),
  });
}

/**
 * Maps an extracted template onto the normalized SourceResolvedField roster.
 * The template is the primary authority for which fields exist: labels are
 * canonicalized server-side (identical normalized labels mean identical
 * structural identity), mechanical fields keep their printed bounds, identity
 * fields never carry bounds, and every field is tagged with the
 * `sheet-template` origin.
 *
 * A template whose mode disagrees with the authoring mode is rejected as a
 * visible conflict, not silently reinterpreted.
 */
export function normalizeTemplateFields(
  template: CharacterSheetTemplate,
  mode: CharacterSheetAuthoringMode,
): { fields: SourceResolvedField[]; conflicts: GenerationConflict[] } {
  const fields: SourceResolvedField[] = [];
  const conflicts: GenerationConflict[] = [];
  const seenKeys = new Set<string>();

  if (template.mode !== mode) {
    return {
      fields,
      conflicts: [
        makeConflict(
          "TEMPLATE_MODE_MISMATCH",
          null,
          `The template targets a ${template.mode} sheet but the request is for a ${mode} sheet.`,
          [template.mode, mode],
        ),
      ],
    };
  }

  for (const sourceField of template.fields) {
    const canonicalKey = canonicalizeFieldLabel(sourceField.label);
    if (seenKeys.has(canonicalKey)) {
      conflicts.push(
        makeConflict(
          "DUPLICATE_TEMPLATE_FIELD_LABEL",
          canonicalKey,
          `Template fields "${sourceField.label}" and a previously declared field normalize to the same canonical identity.`,
          [sourceField.label],
        ),
      );
      continue;
    }
    seenKeys.add(canonicalKey);

    if (sourceField.category === "mechanical") {
      fields.push(
        SourceResolvedFieldSchema.parse({
          canonicalKey,
          label: sourceField.label,
          category: "mechanical",
          ...(mode === "pc" ? { explicitValue: null } : {}),
          ...(sourceField.numericBounds !== undefined
            ? {
                permittedValueRange: {
                  min: sourceField.numericBounds.min,
                  max: sourceField.numericBounds.max,
                },
              }
            : {}),
          ...(sourceField.kind !== undefined ? { kind: sourceField.kind } : {}),
          ...(sourceField.sectionKey !== undefined
            ? { sectionKey: sourceField.sectionKey }
            : {}),
          provenance: templateProvenance,
        }),
      );
      continue;
    }

    fields.push(
      SourceResolvedFieldSchema.parse({
        canonicalKey,
        label: sourceField.label,
        category: "identity",
        ...(sourceField.kind !== undefined ? { kind: sourceField.kind } : {}),
        ...(sourceField.sectionKey !== undefined
          ? { sectionKey: sourceField.sectionKey }
          : {}),
        provenance: templateProvenance,
      }),
    );
  }

  return { fields, conflicts };
}

/**
 * Overlays the deterministic GUI authoring source on top of the template
 * roster. The template keeps authority over existence, label, category and
 * bounds; the GUI may only supply values (PC starting values, identity trait
 * text, NPC bounds only for fields the template does not already bound).
 *
 * Disagreements never pick a silent winner: a GUI value outside a template
 * range, a GUI bound that contradicts a template bound, or a GUI field that
 * reuses a template canonical key under a different category each surface as a
 * visible conflict while the template entry is kept intact.
 */
export function overlayTemplateWithGui(input: {
  templateFields: readonly SourceResolvedField[];
  guiFields: readonly SourceResolvedField[];
}): { fields: SourceResolvedField[]; conflicts: GenerationConflict[] } {
  const fields: SourceResolvedField[] = [];
  const conflicts: GenerationConflict[] = [];
  const templateIndex = new Map<string, SourceResolvedField>();
  const positionByIdentity = new Map<string, number>();

  for (const field of input.templateFields) {
    templateIndex.set(`${field.category}:${field.canonicalKey}`, field);
    positionByIdentity.set(
      `${field.category}:${field.canonicalKey}`,
      fields.length,
    );
    fields.push(field);
  }

  for (const guiField of input.guiFields) {
    const identity = `${guiField.category}:${guiField.canonicalKey}`;
    const templateField = templateIndex.get(identity);
    const position = positionByIdentity.get(identity);

    if (templateField === undefined) {
      const crossCategory = [...templateIndex.values()].find(
        (field) => field.canonicalKey === guiField.canonicalKey,
      );
      if (crossCategory !== undefined) {
        conflicts.push(
          makeConflict(
            "TEMPLATE_CATEGORY_DISAGREEMENT",
            guiField.canonicalKey,
            `The template declares "${crossCategory.label}" as ${crossCategory.category} but the request declares the same canonical key as ${guiField.category}. The request field is kept because the user asked for it explicitly.`,
            [crossCategory.label, guiField.label],
          ),
        );
      }
      positionByIdentity.set(identity, fields.length);
      fields.push(guiField);
      continue;
    }

    const merged = overlayValueAndRange(templateField, guiField);
    if (merged.conflict !== null) {
      conflicts.push(merged.conflict);
    }
    if (position !== undefined) {
      fields[position] = merged.field;
    }
  }

  return { fields, conflicts };
}

function overlayValueAndRange(
  templateField: SourceResolvedField,
  guiField: SourceResolvedField,
): { field: SourceResolvedField; conflict: GenerationConflict | null } {
  let conflict: GenerationConflict | null = null;
  let explicitValue = templateField.explicitValue;
  let permittedValueRange = templateField.permittedValueRange;

  if (
    templateField.permittedValueRange !== undefined &&
    guiField.permittedValueRange !== undefined &&
    (templateField.permittedValueRange.min !==
      guiField.permittedValueRange.min ||
      templateField.permittedValueRange.max !==
        guiField.permittedValueRange.max)
  ) {
    conflict = makeConflict(
      "TEMPLATE_BOUND_DISAGREEMENT",
      templateField.canonicalKey,
      `The template bounds ${templateField.permittedValueRange.min}..${templateField.permittedValueRange.max} for "${templateField.label}" contradict the request bounds ${guiField.permittedValueRange.min}..${guiField.permittedValueRange.max}; the template bound is kept.`,
      [templateField.label, guiField.label],
    );
  } else if (guiField.permittedValueRange !== undefined) {
    permittedValueRange = guiField.permittedValueRange;
  }

  const guiValue =
    guiField.explicitValue === null || guiField.explicitValue === undefined
      ? null
      : guiField.explicitValue;

  if (guiValue !== null) {
    if (
      guiField.category === "mechanical" &&
      typeof guiValue === "number" &&
      permittedValueRange !== undefined &&
      (guiValue < permittedValueRange.min || guiValue > permittedValueRange.max)
    ) {
      conflict =
        conflict ??
        makeConflict(
          "INVALID_CONSTRAINT_VALUE",
          templateField.canonicalKey,
          `Request value ${guiValue} for "${templateField.label}" falls outside the template range ${permittedValueRange.min}..${permittedValueRange.max} and is not applied.`,
          [templateField.label, guiField.label],
        );
    } else if (explicitValue !== guiValue) {
      explicitValue = guiValue;
    }
  }

  const field: SourceResolvedField = SourceResolvedFieldSchema.parse({
    canonicalKey: templateField.canonicalKey,
    label: templateField.label,
    category: templateField.category,
    ...(explicitValue !== undefined ? { explicitValue } : {}),
    ...(permittedValueRange !== undefined ? { permittedValueRange } : {}),
    ...(templateField.kind !== undefined ? { kind: templateField.kind } : {}),
    ...(templateField.sectionKey !== undefined
      ? { sectionKey: templateField.sectionKey }
      : {}),
    provenance: mergeProvenance(templateField.provenance, guiField.provenance),
  });

  return { field, conflict };
}
