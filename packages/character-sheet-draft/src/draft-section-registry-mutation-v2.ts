import { z } from "zod";
import { draftError } from "./errors";
import {
  MAX_DRAFT_FIELD_KEY_CHARS,
  MAX_DRAFT_FIELD_LABEL_CHARS,
  MAX_DRAFT_SECTIONS,
} from "./draft-schema";
import {
  draftKeyPattern,
  DraftSectionV2Schema,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
  type DraftSectionV2,
} from "./draft-schema-v2";
import {
  DEFAULT_DRAFT_CONTAINER_LAYOUT_V1,
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  type DraftLayoutV1,
} from "./draft-layout-v1";
import { nextDraftVersion } from "./versioning";

const SECTION_MUTATION_KEY_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Section keys must use safe canonical keys.");

const SECTION_MUTATION_TITLE_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_LABEL_CHARS)
  .regex(/\S/, "A section title must contain non-whitespace.");

export const DraftAddSectionMutationV2Schema = z.strictObject({
  op: z.literal("add_section"),
  section: z.strictObject({
    key: SECTION_MUTATION_KEY_SCHEMA,
    title: SECTION_MUTATION_TITLE_SCHEMA,
  }),
});
export type DraftAddSectionMutationV2 = z.infer<
  typeof DraftAddSectionMutationV2Schema
>;

export const DraftRenameSectionMutationV2Schema = z.strictObject({
  op: z.literal("rename_section"),
  key: SECTION_MUTATION_KEY_SCHEMA,
  title: SECTION_MUTATION_TITLE_SCHEMA,
});
export type DraftRenameSectionMutationV2 = z.infer<
  typeof DraftRenameSectionMutationV2Schema
>;

/**
 * Isolated V2 section registry mutation contract. `op` is the discriminant;
 * `expectedVersion` is deliberately OUT of the payload (pass it to the apply
 * function instead). add_section/rename_section modify the Section registry;
 * add_section additionally owns the single canonical Root placement it creates.
 */
export const DraftSectionRegistryMutationV2Schema = z.discriminatedUnion("op", [
  DraftAddSectionMutationV2Schema,
  DraftRenameSectionMutationV2Schema,
]);
export type DraftSectionRegistryMutationV2 = z.infer<
  typeof DraftSectionRegistryMutationV2Schema
>;

/**
 * Parses untrusted input into a validated V2 section registry mutation. Throws
 * `DraftError("invalid_mutation")` on rejection (including extra properties,
 * parentKey/fieldKeys/destination smuggled into a section, and an
 * `expectedVersion` smuggled into the payload). Parser failures never escape
 * as ZodError.
 */
export function parseDraftSectionRegistryMutationV2(
  input: unknown,
): DraftSectionRegistryMutationV2 {
  const result = DraftSectionRegistryMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The section registry mutation is invalid."
        : `The section registry mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies one validated V2 section registry mutation to a canonical V2 draft.
 *
 * Precondition order is fixed and mirrors 4A1 / 4A2:
 * 1. `expectedVersion === draft.version` (version_conflict wins over every
 *    lower-level validation)
 * 2. confirmed guard (draft_confirmed)
 * 3. mutation-specific target/domain validation
 * 4. semantic no-op detection (same-title rename returns the original draft)
 * 5. immutable change (sections[] and, for add, structure[] stay in sync)
 * 6. version bumped exactly once via `nextDraftVersion`
 * 7. `baseVersion` preserved
 * 8. `validateDraftV2` used as a validation GATE
 * 9. the constructed candidate is returned (not Zod's parsed clone)
 */
export function applyDraftSectionRegistryMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftSectionRegistryMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  switch (mutation.op) {
    case "add_section":
      return applyAddSection(draft, mutation);
    case "rename_section":
      return applyRenameSection(draft, mutation);
  }
}

function assertMatchingVersion(
  draft: CharacterSheetDraftV2,
  expectedVersion: number,
): void {
  if (expectedVersion !== draft.version) {
    throw draftError(
      "version_conflict",
      `Expected version ${expectedVersion} but draft is at version ${draft.version}.`,
    );
  }
}

function assertV2Editable(draft: CharacterSheetDraftV2): void {
  if (draft.confirmed === true) {
    throw draftError(
      "draft_confirmed",
      "The draft is confirmed and read-only; it cannot be mutated.",
    );
  }
}

function applyAddSection(
  draft: CharacterSheetDraftV2,
  mutation: DraftAddSectionMutationV2,
): CharacterSheetDraftV2 {
  const section = parseSectionDefinition(mutation.section);
  if (draft.sections.some((entry) => entry.key === section.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft section "${section.key}" already exists.`,
    );
  }
  if (draft.fields.some((field) => field.key === section.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft section key "${section.key}" collides with an existing field.`,
    );
  }
  if (draft.sections.length >= MAX_DRAFT_SECTIONS) {
    throw draftError(
      "surface_out_of_bounds",
      `A draft may contain at most ${MAX_DRAFT_SECTIONS} sections.`,
    );
  }

  const newPlacement: DraftPlacement = {
    kind: "section",
    key: section.key,
    parentKey: null,
  };
  return commitV2(draft, {
    ...draft,
    sections: [...draft.sections, section],
    structure: [...draft.structure, newPlacement],
    layout: withAddedSectionLayout(draft.layout, section.key),
  });
}

function applyRenameSection(
  draft: CharacterSheetDraftV2,
  mutation: DraftRenameSectionMutationV2,
): CharacterSheetDraftV2 {
  const section = draft.sections.find((entry) => entry.key === mutation.key);
  if (section === undefined) {
    throw draftError(
      "invalid_mutation",
      `Draft section "${mutation.key}" does not exist.`,
    );
  }
  if (section.title === mutation.title) {
    return draft;
  }
  return commitV2(draft, {
    ...draft,
    sections: draft.sections.map((entry) =>
      entry.key === mutation.key ? { ...entry, title: mutation.title } : entry,
    ),
  });
}

/**
 * Layout maintenance for add_section: an explicit layout gains the default
 * node entry plus the default single-column container entry for the new
 * Section; a layoutless draft stays layoutless (never partial).
 */
function withAddedSectionLayout(
  layout: DraftLayoutV1 | undefined,
  key: string,
): DraftLayoutV1 | undefined {
  if (layout === undefined) {
    return undefined;
  }
  return {
    ...layout,
    sections: {
      ...layout.sections,
      [key]: { ...DEFAULT_DRAFT_CONTAINER_LAYOUT_V1 },
    },
    nodes: { ...layout.nodes, [key]: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 } },
  };
}

function parseSectionDefinition(input: unknown): DraftSectionV2 {
  const result = DraftSectionV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The new section is invalid."
        : `The new section is invalid: ${first.message}`,
    );
  }
  return result.data;
}

function commitV2(
  draft: CharacterSheetDraftV2,
  next: CharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  const candidate: CharacterSheetDraftV2 = {
    ...next,
    version: nextDraftVersion(draft.version),
    baseVersion: draft.baseVersion,
  };
  validateDraftV2(candidate);
  return candidate;
}
