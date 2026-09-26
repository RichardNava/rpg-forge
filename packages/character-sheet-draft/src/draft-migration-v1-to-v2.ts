import { z } from "zod";
import { draftError } from "./errors";
import {
  CharacterSheetDraftSchema,
  type CharacterSheetDraft,
  type DraftSection,
  type DraftField,
  type DraftValue,
} from "./draft-schema";
import {
  CharacterSheetDraftV2Schema,
  type CharacterSheetDraftV2,
  type DraftSectionV2,
  type DraftPlacement,
  validateDraftV2,
} from "./draft-schema-v2";

/** Strict V1 parser — reuses the official V1 schema. */
export const LegacyCharacterSheetDraftV1Schema = CharacterSheetDraftSchema;
export type LegacyCharacterSheetDraftV1 = CharacterSheetDraft;

/** Parses untrusted input as a strict V1 draft. */
export function parseLegacyCharacterSheetDraftV1(
  value: unknown,
): LegacyCharacterSheetDraftV1 {
  const result = LegacyCharacterSheetDraftV1Schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_draft",
      first === undefined
        ? "The V1 draft is invalid."
        : `The V1 draft is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/** Migrates a VALIDATED V1 draft to canonical V2. */
export function migrateCharacterSheetDraftV1ToV2(
  legacy: LegacyCharacterSheetDraftV1,
): CharacterSheetDraftV2 {
  const v1 = { ...legacy };
  const sections = v1.sections ?? [];
  const sectionMap = new Map(sections.map((s) => [s.key, s]));
  const assignedFields = new Set(sections.flatMap((s) => s.fieldKeys));

  const structure: DraftPlacement[] = [];

  function visitSection(sectionKey: string, parentKey: string | null) {
    const section = sectionMap.get(sectionKey);
    if (!section) return;

    structure.push({ kind: "section", key: section.key, parentKey });

    for (const fieldKey of section.fieldKeys) {
      const field = v1.fields.find((f) => f.key === fieldKey);
      if (field) {
        structure.push({
          kind: "field",
          key: fieldKey,
          parentKey: section.key,
        });
      }
    }

    const children = sections
      .filter((s) => s.parentKey === section.key)
      .sort((a, b) => sections.indexOf(a) - sections.indexOf(b));

    for (const child of children) {
      visitSection(child.key, section.key);
    }
  }

  const rootSections = sections
    .filter((s) => s.parentKey === undefined)
    .sort((a, b) => sections.indexOf(a) - sections.indexOf(b));

  for (const section of rootSections) {
    visitSection(section.key, null);
  }

  for (const field of v1.fields) {
    if (!assignedFields.has(field.key)) {
      structure.push({ kind: "field", key: field.key, parentKey: null });
    }
  }

  const v2Sections: DraftSectionV2[] = sections.map((s) => ({
    key: s.key,
    title: s.title,
  }));

  const migrated: CharacterSheetDraftV2 = {
    schemaVersion: "2",
    draftId: v1.draftId,
    sessionId: v1.sessionId,
    baseVersion: v1.baseVersion,
    version: v1.version,
    mode: v1.mode,
    characterName: v1.characterName,
    rulesContextId: v1.rulesContextId,
    fields: v1.fields,
    sections: v2Sections,
    structure,
    values: v1.values,
    source: v1.source,
    confirmed: v1.confirmed,
  };

  return validateDraftV2(migrated);
}
