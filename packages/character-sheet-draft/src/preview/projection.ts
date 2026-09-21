import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetField,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import type {
  CharacterSheetDraft,
  DraftField,
  DraftValue,
} from "../draft-schema";
import { MAX_DRAFT_TEXT_VALUE_CHARS } from "../draft-schema";
import { draftError } from "../errors";
import { surfaceKeys } from "../guided-edit";

const FIELD_PLACEMENT = {
  order: 0,
  columnStart: 1,
  columnSpan: 1,
  rowSpan: 1,
  breakBefore: false,
} as const;

/**
 * Deterministic, renderable `CharacterSheetSpec` projection of a draft
 * surface. It exists so a preview can render straight from the draft alone,
 * with no run artifact and no provider: one page, one flow section, default
 * theme, no source map. The projected spec is schema- and domain-validated
 * before it is returned.
 */
export function projectDraftToSpec(
  draft: CharacterSheetDraft,
): CharacterSheetSpec {
  const fieldIds = surfaceKeys(draft);
  const fields: CharacterSheetField[] = fieldIds.map((key) => {
    const field = draft.fields.find((entry) => entry.key === key);
    if (field === undefined) {
      throw draftError(
        "projection_invalid",
        `Draft surface references unknown key "${key}".`,
      );
    }
    return draftFieldToSpecField(field);
  });

  const values: Record<string, DraftValue> = {};
  for (const [key, value] of Object.entries(draft.values)) {
    if (fieldIds.includes(key)) {
      values[key] = value;
    }
  }

  const draftSections = draft.sections ?? [];
  const assignedKeys = new Set(
    draftSections.flatMap((section) => section.fieldKeys),
  );
  const projectedSections = [
    ...draftSections
      .filter((section) => section.fieldKeys.length > 0)
      .map((section, index) => ({
        id: `draft.section.${section.key}`,
        title: sectionTitle(draft, section.key),
        layout: {
          mode: "flow" as const,
          columns: 1,
          order: index,
          emphasis: null,
        },
        fieldIds: section.fieldKeys,
      })),
    ...(fieldIds.filter((key) => !assignedKeys.has(key)).length > 0
      ? [
          {
            id:
              draftSections.length === 0
                ? "draft.section"
                : "draft.section.ungrouped",
            title: draft.mode === "npc" ? "NPC" : "Character",
            layout: {
              mode: "flow" as const,
              columns: 1,
              order: draftSections.length,
              emphasis: null,
            },
            fieldIds: fieldIds.filter((key) => !assignedKeys.has(key)),
          },
        ]
      : []),
  ];
  const spec: CharacterSheetSpec = {
    schemaVersion: "1",
    mode: draft.mode === "pc" ? "player" : "npc",
    metadata: {
      id: `sheet.draft.${draft.draftId}`,
      title: draft.characterName ?? "Untitled draft",
      description: null,
      locale: null,
    },
    rulesContextId: draft.rulesContextId,
    pages: [
      {
        id: "draft.page",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: projectedSections.map((section) => section.id),
        },
      },
    ],
    sections: projectedSections,
    fields,
    values,
    theme: {
      style: "minimal",
      typography: "serif",
      density: "standard",
      borderStyle: "none",
      decorationIntensity: "none",
      accentColor: "#332211",
      backgroundIntent: "none",
    },
    sourceMap: {},
  };

  return validateProjectedSpec(spec);
}

function draftFieldToSpecField(field: DraftField): CharacterSheetField {
  switch (field.type) {
    case "text":
      return {
        type: "text",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
        maxLength: MAX_DRAFT_TEXT_VALUE_CHARS,
      };
    case "textarea":
      return {
        type: "textarea",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
      };
    case "number":
      return {
        type: "number",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
      };
    case "checkbox":
      return {
        type: "checkbox",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
      };
    case "choice":
      return {
        type: "select",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
        options: (field.options ?? []).map((option) => ({
          value: option,
          label: option,
        })),
      };
    case "list":
      return {
        type: "list",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement: FIELD_PLACEMENT,
        itemLabel: field.label,
        maxItems: 100,
      };
  }
}

function sectionTitle(draft: CharacterSheetDraft, key: string): string {
  const section = (draft.sections ?? []).find((entry) => entry.key === key);
  if (section === undefined) return key;
  return section.parentKey === undefined
    ? section.title
    : `${sectionTitle(draft, section.parentKey)} · ${section.title}`;
}

function validateProjectedSpec(spec: CharacterSheetSpec): CharacterSheetSpec {
  const parsed = CharacterSheetSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw draftError(
      "projection_invalid",
      first === undefined
        ? "The projected draft spec is invalid."
        : `The projected draft spec is invalid: ${first.message}`,
    );
  }
  const domain = validateCharacterSheetSpecDomain(parsed.data);
  if (!domain.valid) {
    throw draftError(
      "projection_invalid",
      `The projected draft spec fails domain validation: ${domain.issues
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  return parsed.data;
}
