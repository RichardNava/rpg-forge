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
 * 4E1 canonical V2 draft persistence port.
 *
 * Exported EXPLICITLY and separately from the V1 `CharacterSheetDraftStore`
 * barrel (`export * from "./draft-store"`, line above). The two ports are
 * deliberately NOT unified, widened to a union, or generalized into a `<T>`
 * store: the live V1 Worker still consumes the V1 port, and a canonical V2
 * consumer must never receive V1. `CharacterSheetDraftIdentity` is reused from
 * the V1 module rather than duplicated, because both ports address the same
 * immutable key layout.
 *
 * The frozen behavior this port commits to is specified in
 * `docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md`.
 */
export type { CharacterSheetDraftStoreV2 } from "./draft-store-v2";

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

/**
 * 4D public V2 transport boundary.
 *
 * Exported EXPLICITLY rather than with `export * from "./draft-transport-v2"` so
 * the reviewed public surface stays small and reviewable. The two module-local
 * helpers that make the envelopes strict — `DraftExpectedVersionSchema` (the
 * shared optimistic-concurrency precondition) and `RerolledDraftKeySchema` (the
 * reroll reporting key grammar) — stay PRIVATE implementation detail; a consumer
 * never needs either, because both are already enforced by the exported schemas.
 *
 * These six schemas freeze the SHAPE of the V2 draft transport payloads for the
 * 4E Worker cutover. They are pure validation: they never apply a mutation, bump
 * a version, compare a precondition against current state, confirm, reroll,
 * migrate, persist, or map HTTP errors.
 *
 * The whole public V2 flow is reachable through this package root:
 *
 *   READ     parseCanonicalCharacterSheetDraft, buildDraftStructuralReadModelV2,
 *            projectDraftV2ToSpec
 *   CREATE   SheetDraftCreateRequestV2Schema, initialDraftVersionV2
 *   EDIT     SheetDraftMutationRequestV2Schema, parseDraftMutationV2,
 *            applyDraftMutationV2
 *   REROLL   SheetDraftRerollRequestV2Schema, rerollLockedDraftValuesV2,
 *            SheetDraftRerollResponseV2Schema
 *   CONFIRM  SheetDraftConfirmRequestV2Schema, finalizeDraftV2
 *   RESPOND  SheetDraftSnapshotResponseV2Schema
 *
 * The frozen contract these encode — including the D1 `head.currentVersion`
 * precondition, the mandatory D1 claim race barrier, the semantic no-op bypass,
 * the error taxonomy, and the raw (unwrapped) confirm response — is specified in
 * `docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md`.
 *
 * Two deliberate contract facts, not oversights:
 * - `expectedVersion` stays OUTSIDE `DraftMutationV2` in the request envelope,
 *   because the concurrency precondition is a transport concern and the mutation
 *   is the domain command.
 * - Transport responses are canonical V2 ONLY, with no V1|V2 union. Historical V1
 *   persistence is handled by `parseCanonicalCharacterSheetDraft` BEFORE the
 *   response is produced.
 */
export {
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
} from "./draft-transport-v2";
export type {
  SheetDraftConfirmRequestV2,
  SheetDraftCreateRequestV2,
  SheetDraftMutationRequestV2,
  SheetDraftRerollRequestV2,
  SheetDraftRerollResponseV2,
  SheetDraftSnapshotResponseV2,
} from "./draft-transport-v2";
