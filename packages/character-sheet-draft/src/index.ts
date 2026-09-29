export * from "./errors";
export * from "./reroll-random";
export * from "./draft-schema";
export * from "./draft-types";
export * from "./versioning";
export * from "./authoring-session";
export * from "./guided-edit";
export * from "./in-flight-processing";
export * from "./mutation-api";
export * from "./reroll";
export * from "./finalize";
export * from "./keys";
export * from "./draft-store";
export * from "./preview/index";
export { parseCanonicalCharacterSheetDraft } from "./draft-canonical";
export type { CharacterSheetDraftV2 } from "./draft-schema-v2";

/**
 * 4C public V2 read boundary.
 *
 * Exported EXPLICITLY rather than with `export * from "./draft-read-model-v2"`
 * so the reviewed public surface stays small and reviewable: only the resolution
 * layer above the structural index is public, while the lower structural
 * machinery (`buildDraftStructuralIndex`, `getDraftPlacement`,
 * `getDraftChildren`, `getDraftParentKey`, `getDraftDepth`,
 * `getDraftSubtreeRange`, `DraftStructuralIndex`, `DraftSubtreeRange`) stays
 * private implementation detail. Future Web consumers should read the
 * structural view through `buildDraftStructuralReadModelV2`, not the index.
 */
export { buildDraftStructuralReadModelV2 } from "./draft-read-model-v2";
export type {
  DraftFieldReadNodeV2,
  DraftSectionReadNodeV2,
  DraftReadNodeV2,
  DraftStructuralReadModelV2,
} from "./draft-read-model-v2";

/**
 * 4C public V2 projection boundary.
 *
 * `projectDraftV2ToSpec` is exported straight from its own module through the
 * package root; `preview/index.ts` is deliberately left untouched so the
 * historical V1 preview barrel is not broadened merely to expose this one V2
 * operation. Only this function is public — the run/pagination helpers
 * (`ProjectedFieldRun`, `contextTitle`, `fieldKeysInCanonicalOrder`,
 * `buildProjectedFieldRuns`, `chunkRunsIntoSections`, `chunkSectionsIntoPages`,
 * `draftFieldToSpecField`, `validateProjectedSpec`) and the adapter capacity
 * constants remain private.
 *
 * V1 `projectDraftToSpec` and `writebackDraftToSpec` remain public through
 * `./preview/index`. The two projections are deliberately NOT unified or
 * overloaded: they are distinct structural models, and migration keeps them
 * explicit.
 */
export { projectDraftV2ToSpec } from "./preview/projection-v2";

export {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  CharacterSheetDraftV2Schema,
  validateDraftV2,
} from "./draft-schema-v2";
export {
  applyDraftMutationV2,
  DraftMutationV2Schema,
  parseDraftMutationV2,
} from "./draft-mutation-v2";
export type { DraftMutationV2 } from "./draft-mutation-v2";
export { initialDraftVersionV2 } from "./draft-versioning-v2";
export type { InitialCharacterSheetDraftV2 } from "./draft-versioning-v2";
export { rerollLockedDraftValuesV2 } from "./draft-reroll-v2";
export type { DraftRerollResultV2 } from "./draft-reroll-v2";
export { finalizeDraftV2 } from "./draft-finalize-v2";
