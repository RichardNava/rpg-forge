import {
  CharacterSheetTemplateSchema,
  type CharacterSheetTemplate,
} from "./template.js";
import type { CharacterSheetTemplateExtractionPort } from "./extraction.js";
import type { CharacterSheetTemplateSource } from "./source.js";

/**
 * The reference extractor is a NON-PRODUCTION, offline stand-in for a
 * multimodal sheet reader. It never consumes AI quota and never reads real
 * files: it maps an opaque source key to one hand-authored template from a
 * small in-memory catalog. It exists so the extraction->normalization->merge
 * pipeline can be exercised end-to-end deterministically in automated tests
 * until a production multimodal provider is committed (see phase-14.7/14.7C).
 */
export const REFERENCE_TEMPLATE_CATALOG: Readonly<
  Record<string, CharacterSheetTemplate>
> = {
  "direct-sheet:one-shot-pc": CharacterSheetTemplateSchema.parse({
    schemaVersion: 1,
    mode: "pc",
    sections: [
      {
        key: "identity",
        title: "Identity",
        purpose: "Personal traits of the character.",
      },
      {
        key: "attributes",
        title: "Attributes",
        purpose: "The character's mechanical attributes.",
      },
    ],
    fields: [
      {
        label: "Character Name",
        category: "identity",
        kind: "text",
        sectionKey: "identity",
      },
      {
        label: "Background",
        category: "identity",
        kind: "textarea",
        sectionKey: "identity",
      },
      {
        label: "Motivation",
        category: "identity",
        kind: "textarea",
        sectionKey: "identity",
      },
      {
        label: "Vigor",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 1, max: 10 },
      },
      {
        label: "Prowess",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 1, max: 10 },
      },
      {
        label: "Wits",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 1, max: 10 },
      },
    ],
  }),
  "direct-sheet:one-shot-npc": CharacterSheetTemplateSchema.parse({
    schemaVersion: 1,
    mode: "npc",
    sections: [
      { key: "identity", title: "Identity", purpose: "Who the NPC is." },
      {
        key: "attributes",
        title: "Attributes",
        purpose: "The NPC's mechanical attributes.",
      },
    ],
    fields: [
      {
        label: "Character Name",
        category: "identity",
        kind: "text",
        sectionKey: "identity",
      },
      {
        label: "Role",
        category: "identity",
        kind: "text",
        sectionKey: "identity",
      },
      {
        label: "Guard Rating",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 1, max: 20 },
      },
      {
        label: "Composure",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 1, max: 20 },
      },
    ],
  }),
  "rulebook-contained-sheet:intro-sample": CharacterSheetTemplateSchema.parse({
    schemaVersion: 1,
    mode: "npc",
    sections: [
      {
        key: "identity",
        title: "Identity",
        purpose: "Sample NPC sheet printed inside the rulebook.",
      },
      {
        key: "attributes",
        title: "Attributes",
        purpose: "Mechanical attributes of the sample NPC.",
      },
    ],
    fields: [
      {
        label: "Character Name",
        category: "identity",
        kind: "text",
        sectionKey: "identity",
      },
      {
        label: "Craft",
        category: "identity",
        kind: "text",
        sectionKey: "identity",
      },
      {
        label: "Dexterity",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 3, max: 18 },
      },
      {
        label: "Durability",
        category: "mechanical",
        kind: "number",
        sectionKey: "attributes",
        numericBounds: { min: 3, max: 18 },
      },
    ],
  }),
};

function catalogKey(source: CharacterSheetTemplateSource): string {
  return source.kind === "direct-sheet"
    ? `direct-sheet:${source.sheetKey}`
    : `rulebook-contained-sheet:${source.rulebookKey}`;
}

/**
 * Returns a reference extractor whose catalog can be augmented for a test
 * fixture. Unknown keys cause a throw so `extractSheetTemplate` reports
 * `extraction_unavailable`, mirroring a real provider outage.
 */
export function createReferenceSheetTemplateExtractor(
  catalog: Readonly<
    Record<string, CharacterSheetTemplate>
  > = REFERENCE_TEMPLATE_CATALOG,
): CharacterSheetTemplateExtractionPort {
  return {
    async extract(input) {
      const template = catalog[catalogKey(input.source)];
      if (template === undefined) {
        throw new ReferenceExtractionUnavailableError();
      }
      return JSON.stringify(template);
    },
  };
}

export class ReferenceExtractionUnavailableError extends Error {
  constructor() {
    super("No reference template exists for the requested source key.");
    this.name = "ReferenceExtractionUnavailableError";
  }
}
