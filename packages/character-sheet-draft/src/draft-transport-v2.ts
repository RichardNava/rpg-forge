import { z } from "zod";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import {
  CharacterSheetDraftV2Schema,
  draftKeyPattern,
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { DraftMutationV2Schema } from "./draft-mutation-v2";

/**
 * 4D1 — CANONICAL V2 TRANSPORT SCHEMAS (internal; not yet public).
 *
 * These schemas freeze the SHAPE of the V2 draft transport payloads that 4E will
 * wire into the Worker and the Web API client. They are pure validation: they
 * never apply a mutation, bump a version, compare a precondition against current
 * state, confirm, reroll, migrate, persist, or map HTTP errors. Those belong to
 * later layers.
 *
 * ## Domain operation vs concurrency precondition
 *
 * Transport distinguishes the two deliberately. A DOMAIN OPERATION is the
 * typed `DraftMutationV2` command; the CONCURRENCY PRECONDITION
 * (`expectedVersion`) is a transport concern and therefore stays OUTSIDE
 * `DraftMutationV2` in a request envelope:
 *
 * - mutation: `{ expectedVersion, mutation }`
 * - reroll:   `{ expectedVersion, seed }`
 * - confirm:  `{ expectedVersion }`
 *
 * Creation has no `expectedVersion`: there is no prior version to race against.
 *
 * ## What `expectedVersion` means
 *
 * `expectedVersion` is "the version the caller believes is current". The
 * authoritative head version is the server's, not the client's. In the future
 * Worker layer, when `expectedVersion` does not match the authoritative
 * head/current version, the request is rejected with
 * `SHEET_DRAFT_VERSION_CONFLICT` (HTTP 409), and that check happens BEFORE
 * applying the mutation, reroll, or confirmation. 4D1 does not implement that
 * check; it only fixes the payload that carries it.
 *
 * ## Why reroll and confirm also require it
 *
 * Without a precondition, a stale client that is still viewing v7 could request
 * a reroll or a confirmation after the server has already advanced to v8, and
 * the action would silently apply to v8 instead. Therefore every state-changing
 * operation after creation carries an explicit version precondition, not just
 * edits.
 *
 * ## Response policy
 *
 * Normal draft responses are the RAW canonical V2 snapshot — create, get,
 * mutation and confirm all return `CharacterSheetDraftV2` directly, with no
 * operation-specific wrapper. Only reroll wraps, because it additionally reports
 * which keys it rerolled. This deliberately means the future V2 confirm route
 * returns the raw confirmed snapshot rather than a `{ draft: ... }` envelope;
 * 4E implements that runtime correction.
 *
 * ## Historical read policy
 *
 * Transport responses are V2 ONLY, and there is deliberately no V1|V2 response
 * union. Historical V1 persistence still exists, so the read path is:
 * stored V1 or V2 -> `parseCanonicalCharacterSheetDraft(...)` ->
 * `CharacterSheetDraftV2` -> HTTP response. The canonical parser owns
 * compatibility; transport never sees V1.
 *
 * ## HTTP route versioning
 *
 * These schemas say nothing about URL route versioning. The current `/v1/...`
 * route prefix, the draft `schemaVersion`, and the R2 key layout are three
 * separate concerns and are deliberately not conflated here. Whether route
 * versions change is not decided by this slice.
 */

/**
 * Shared optimistic-concurrency precondition.
 *
 * A positive integer. Zero, negatives, fractional values, `NaN` and numeric
 * strings are all rejected, because an unusable precondition must fail at the
 * transport edge rather than being coerced into a comparison later.
 */
const DraftExpectedVersionSchema = z.number().int().min(1);

/**
 * Canonical draft key, reused for reroll reporting so transport does not
 * duplicate the domain key grammar.
 */
const RerolledDraftKeySchema = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern);

/**
 * CREATE request body.
 *
 * The client supplies the complete draft, so transport structural validity is
 * exactly canonical V2 validity. The route-level "created at version 1" policy
 * is a Worker concern for 4E and is intentionally NOT encoded here: it would
 * duplicate `CharacterSheetDraftV2Schema` to assert a single field.
 */
export const SheetDraftCreateRequestV2Schema = CharacterSheetDraftV2Schema;
export type SheetDraftCreateRequestV2 = CharacterSheetDraftV2;

/**
 * Draft snapshot response, shared by the create, get, mutation and confirm
 * responses. One schema rather than four identical ones, because the frozen
 * response policy is "raw canonical V2 snapshot" in every one of those cases.
 */
export const SheetDraftSnapshotResponseV2Schema = CharacterSheetDraftV2Schema;
export type SheetDraftSnapshotResponseV2 = CharacterSheetDraftV2;

/**
 * MUTATE request body: a concurrency precondition plus a typed domain command.
 *
 * Strict at the top level, so unknown envelope keys (and a `seed` or `force`
 * smuggled alongside the mutation) are rejected. `mutation` keeps its own strict
 * discriminated union, which independently rejects an `expectedVersion` placed
 * INSIDE the mutation payload.
 */
export const SheetDraftMutationRequestV2Schema = z.strictObject({
  expectedVersion: DraftExpectedVersionSchema,
  mutation: DraftMutationV2Schema,
});
export type SheetDraftMutationRequestV2 = z.infer<
  typeof SheetDraftMutationRequestV2Schema
>;

/**
 * REROLL request body: a concurrency precondition plus a stable seed.
 *
 * The seed bounds mirror the current V1 transport bounds exactly, so reroll
 * seeds transfer across the cutover without change. `expectedVersion` is a
 * transport precondition and is deliberately NOT added to
 * `rerollLockedDraftValuesV2` itself.
 */
export const SheetDraftRerollRequestV2Schema = z.strictObject({
  expectedVersion: DraftExpectedVersionSchema,
  seed: z.string().min(1).max(256),
});
export type SheetDraftRerollRequestV2 = z.infer<
  typeof SheetDraftRerollRequestV2Schema
>;

/**
 * REROLL response body: the new authoritative V2 snapshot plus the keys the
 * reroll actually changed.
 *
 * This is the one wrapped draft response, because reroll carries information a
 * bare snapshot cannot. `rerolledKeys` reuses the canonical draft key grammar
 * rather than duplicating it; an empty array is valid and means no Field had a
 * draw grammar.
 */
export const SheetDraftRerollResponseV2Schema = z.strictObject({
  draft: CharacterSheetDraftV2Schema,
  rerolledKeys: z.array(RerolledDraftKeySchema),
});
export type SheetDraftRerollResponseV2 = z.infer<
  typeof SheetDraftRerollResponseV2Schema
>;

/**
 * CONFIRM request body: a concurrency precondition, and nothing else.
 *
 * There is no empty-body confirm in V2: the old V1 route took no body at all,
 * which is exactly what made an unguarded confirmation possible.
 */
export const SheetDraftConfirmRequestV2Schema = z.strictObject({
  expectedVersion: DraftExpectedVersionSchema,
});
export type SheetDraftConfirmRequestV2 = z.infer<
  typeof SheetDraftConfirmRequestV2Schema
>;
