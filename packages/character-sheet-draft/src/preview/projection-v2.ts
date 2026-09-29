import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetField,
  type CharacterSheetPage,
  type CharacterSheetSection,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import {
  buildDraftStructuralReadModelV2,
  type DraftReadNodeV2,
  type DraftStructuralReadModelV2,
} from "../draft-read-model-v2";
import type { DraftField, DraftValue } from "../draft-schema";
import { MAX_DRAFT_TEXT_VALUE_CHARS } from "../draft-schema";
import type { CharacterSheetDraftV2 } from "../draft-schema-v2";
import { draftError } from "../errors";

/**
 * Mirrors the current flat `CharacterSheetSpec` limits. These are adapter-local
 * constants, deliberately not imports, so this projection fails closed on its
 * own terms instead of silently depending on schema internals.
 */
const MAX_PAGES = 12;
const MAX_SECTIONS_PER_PAGE = 16;
/** Mirrors the current flat-section fieldId capacity of 64. */
const MAX_FIELD_IDS_PER_SECTION = 64;
/**
 * Mirrors the global flat `CharacterSheetSpec` Section capacity of
 * `MAX_PAGES * MAX_SECTIONS_PER_PAGE` = 192.
 *
 * This guard is an INTERNAL impossible-state / future-schema protection, not a
 * valid V2 limitation. Every projected Section is non-empty and every canonical
 * Field is projected exactly once, so the projected Section count can never
 * exceed the canonical Field count, which `CharacterSheetDraftV2` bounds at
 * `MAX_DRAFT_SURFACE_FIELDS` = 192. A valid V2 draft therefore cannot reach this
 * threshold; it exists so a future schema relaxation fails closed instead of
 * silently emitting a spec the contract cannot represent.
 */
const MAX_FLAT_SECTIONS = MAX_PAGES * MAX_SECTIONS_PER_PAGE;

const SECTION_LAYOUT = {
  mode: "flow",
  columns: 1,
  emphasis: null,
} as const;

/**
 * One canonical Field run: consecutive Fields of the same structural context
 * that are not separated by an intervening Section boundary.
 */
type ProjectedFieldRun = {
  readonly title: string;
  readonly fieldKeys: string[];
};

/**
 * Deterministic render/export projection of a canonical V2 draft.
 *
 * Structural source of truth is exclusively the 4C1 read model
 * (`buildDraftStructuralReadModelV2`). V1 `section.fieldKeys`,
 * `section.parentKey`, registry ordering and assigned/unassigned
 * reconstruction are never consulted, and no independent Root organizer is
 * introduced.
 *
 * `CharacterSheetSpec` is FLAT while the canonical V2 draft is RECURSIVE, so
 * this is an explicit flattening adapter, not a structural authority. Nested
 * Sections interrupt the parent Field run and the parent resumes afterwards,
 * which is what preserves canonical Field order through a flat target. The
 * resulting repeated Section groups are projection artifacts only;
 * `draft.structure[]` remains canonical.
 *
 * Pure: the input is never mutated and no clock, randomness or environment
 * state participates. The projected spec is schema- and domain-validated
 * before it is returned.
 *
 * @param draft - A canonical V2 draft snapshot
 * @returns A validated, renderable `CharacterSheetSpec`
 * @throws DraftError("invalid_draft") when the draft is not valid V2, and
 * DraftError("projection_invalid") when the exact canonical surface cannot be
 * represented by the current flat `CharacterSheetSpec` contract
 */
export function projectDraftV2ToSpec(
  draft: CharacterSheetDraftV2,
): CharacterSheetSpec {
  // First structural operation: resolve the canonical draft through 4C1.
  const readModel = buildDraftStructuralReadModelV2(draft);

  const canonicalFieldKeys = fieldKeysInCanonicalOrder(readModel);
  const runs = buildProjectedFieldRuns(draft, readModel);
  const sections = chunkRunsIntoSections(runs);

  if (sections.length > MAX_FLAT_SECTIONS) {
    // Unreachable for a valid V2 draft: every projected Section is non-empty and
    // every canonical Field projects exactly once, so Sections <= Fields <= 192.
    // Guarded so a future capacity change fails closed loudly.
    throw draftError(
      "projection_invalid",
      `The canonical V2 surface requires ${sections.length} flat sections, which exceeds the CharacterSheetSpec capacity of ${MAX_FLAT_SECTIONS}. This is an internal invariant violation, not a valid V2 draft limitation.`,
    );
  }

  const fieldOrderByKey = new Map<string, number>();
  for (const section of sections) {
    for (const [index, fieldKey] of section.fieldIds.entries()) {
      fieldOrderByKey.set(fieldKey, index);
    }
  }

  const fields: CharacterSheetField[] = canonicalFieldKeys.map((key) => {
    const node = readModel.nodeByKey.get(key);
    if (node === undefined || node.kind !== "field") {
      throw draftError(
        "projection_invalid",
        `Canonical field "${key}" is not a resolved Field node.`,
      );
    }
    const order = fieldOrderByKey.get(key);
    if (order === undefined) {
      throw draftError(
        "projection_invalid",
        `Canonical field "${key}" was not projected into any section.`,
      );
    }
    return draftFieldToSpecField(node.field, order);
  });

  const values: Record<string, DraftValue> = {};
  for (const key of canonicalFieldKeys) {
    const value = draft.values[key];
    if (value !== undefined) {
      values[key] = value;
    }
  }

  const pages = chunkSectionsIntoPages(sections);

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
    pages,
    sections,
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

/** Canonical global Field order, derived from the read model preorder only. */
function fieldKeysInCanonicalOrder(
  readModel: DraftStructuralReadModelV2,
): string[] {
  return readModel.preorder
    .filter(
      (node): node is Extract<DraftReadNodeV2, { kind: "field" }> =>
        node.kind === "field",
    )
    .map((node) => node.key);
}

/**
 * Walks the canonical preorder and groups consecutive Fields that share a
 * structural context. A Section placement always ends the open run, so a
 * nested Section interrupts its parent and the parent resumes as a new run
 * afterwards. Empty runs never materialize, which is how empty V2 Sections are
 * omitted from the flat projection.
 */
function buildProjectedFieldRuns(
  draft: CharacterSheetDraftV2,
  readModel: DraftStructuralReadModelV2,
): ProjectedFieldRun[] {
  const runs: ProjectedFieldRun[] = [];
  let openContextKey: string | null | undefined;
  let openRun: ProjectedFieldRun | undefined;
  const titleCache = new Map<string, string>();

  for (const node of readModel.preorder) {
    if (node.kind === "section") {
      // Section boundary: close the open run without merging across it.
      openContextKey = undefined;
      openRun = undefined;
      continue;
    }

    const contextKey = node.parentKey;
    if (openRun === undefined || openContextKey !== contextKey) {
      openRun = {
        title: contextTitle(draft, readModel, contextKey, titleCache),
        fieldKeys: [],
      };
      openContextKey = contextKey;
      runs.push(openRun);
    }
    openRun.fieldKeys.push(node.key);
  }

  return runs;
}

/**
 * Title for a structural context: the Section ancestry path for a Section
 * parent, or a generic Root title for top-level Fields. Section titles are read
 * from the read model and never mutated.
 */
function contextTitle(
  draft: CharacterSheetDraftV2,
  readModel: DraftStructuralReadModelV2,
  contextKey: string | null,
  cache: Map<string, string>,
): string {
  if (contextKey === null) {
    return draft.mode === "npc" ? "NPC" : "Character";
  }

  const cached = cache.get(contextKey);
  if (cached !== undefined) {
    return cached;
  }

  const titles: string[] = [];
  let current: string | null = contextKey;
  // Bounded by the validated V2 section depth; a path cache keeps this linear
  // in practice rather than quadratic per Field.
  while (current !== null) {
    const node = readModel.nodeByKey.get(current);
    if (node === undefined || node.kind !== "section") {
      break;
    }
    titles.unshift(node.section.title);
    current = node.parentKey;
  }

  const title = titles.join(" · ");
  cache.set(contextKey, title);
  return title;
}

/**
 * Flattens runs into `CharacterSheetSpec` Sections, splitting any run that
 * exceeds the flat per-section fieldId capacity. Field order and semantics are
 * preserved exactly; only capacity is applied.
 */
function chunkRunsIntoSections(
  runs: ProjectedFieldRun[],
): CharacterSheetSection[] {
  const sections: CharacterSheetSection[] = [];
  for (const run of runs) {
    for (
      let offset = 0;
      offset < run.fieldKeys.length;
      offset += MAX_FIELD_IDS_PER_SECTION
    ) {
      sections.push({
        id: `draft.v2.section.${sections.length}`,
        title: run.title,
        // `order` is assigned during pagination and must be unique per page.
        layout: { ...SECTION_LAYOUT, order: 0 },
        fieldIds: run.fieldKeys.slice(
          offset,
          offset + MAX_FIELD_IDS_PER_SECTION,
        ),
      });
    }
  }
  return sections;
}

/**
 * Assigns Sections to pages in projected-group order, 16 per page. Each Section
 * receives a page-local ordinal `layout.order` so the order is unique within its
 * page, which is what the current domain validator requires, while
 * `page.layout.sectionIds` stays the authoritative render order.
 */
function chunkSectionsIntoPages(
  sections: CharacterSheetSection[],
): CharacterSheetPage[] {
  const pages: CharacterSheetPage[] = [];
  for (
    let offset = 0;
    offset < sections.length;
    offset += MAX_SECTIONS_PER_PAGE
  ) {
    const pageSections = sections.slice(offset, offset + MAX_SECTIONS_PER_PAGE);
    for (const [pageOrder, section] of pageSections.entries()) {
      section.layout = { ...SECTION_LAYOUT, order: pageOrder };
    }
    pages.push({
      id: `draft.v2.page.${pages.length}`,
      layout: {
        orientation: "portrait",
        sizeIntent: null,
        sectionIds: pageSections.map((section) => section.id),
      },
    });
  }
  return pages;
}

function draftFieldToSpecField(
  field: DraftField,
  order: number,
): CharacterSheetField {
  const placement = {
    order,
    columnStart: 1,
    columnSpan: 1,
    rowSpan: 1,
    breakBefore: false,
  } as const;
  switch (field.type) {
    case "text":
      return {
        type: "text",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement,
        maxLength: MAX_DRAFT_TEXT_VALUE_CHARS,
      };
    case "textarea":
      return {
        type: "textarea",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement,
      };
    case "number":
      return {
        type: "number",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
      };
    case "checkbox":
      return {
        type: "checkbox",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement,
      };
    case "choice":
      return {
        type: "select",
        id: field.key,
        label: field.label,
        requiredForPlayableNpc: false,
        placement,
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
        placement,
        itemLabel: field.label,
        maxItems: 100,
      };
  }
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
