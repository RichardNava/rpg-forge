/**
 * 4E3A-R — INTERNAL V2 request boundary (not wired to any route).
 *
 * ## Authority
 *
 * `@repo/character-sheet-draft` is the SINGLE transport-contract authority.
 * Every schema and every inferred type used here is imported from that package
 * and re-exported unchanged; NONE is redefined. In particular this module does
 * NOT define its own `expectedVersion` schema, mutation envelope, reroll
 * envelope, confirm envelope, snapshot response, or reroll response.
 *
 * The re-export block below is a Worker-local façade that gives future handlers
 * one import site, and it deliberately covers ALL SIX frozen schemas including
 * the create schema. A partial façade is an omission trap: it is how the create
 * route would end up importing from two different places.
 *
 * ## What is genuinely Worker-specific here
 *
 * Only the request-PARSE convention at the route edge. A parse failure is a
 * transport concern, so it is returned as a value (`ok` / `invalid`) rather than
 * thrown, letting a handler branch once and never unwrap a `ZodError`. This is
 * the same convention the live V1 route already uses for
 * `SheetDraftRerollRequestSchema.safeParse`.
 *
 * This is NOT a domain result union. V2 domain operations still signal failure
 * by THROWING `DraftError`; nothing here converts a thrown domain error into a
 * result value.
 *
 * ## Frozen request boundary
 *
 * ```text
 * PATCH   .../drafts/{id}         { expectedVersion, mutation }
 * POST    .../drafts/{id}/reroll  { expectedVersion, seed }
 * POST    .../drafts/{id}/confirm { expectedVersion }
 * ```
 *
 * `expectedVersion` is MANDATORY on all three state-changing routes. There is no
 * optional variant, no fallback to the server's `head.currentVersion`, and no
 * compatibility request union. The authoritative version is always the server's
 * D1 head; the client's value is only a precondition, compared before the
 * operation is applied.
 *
 * ## Frozen create policy — SETTLED, NOT OPEN
 *
 * ```text
 * POST    .../drafts              CharacterSheetDraftV2   (no expectedVersion)
 * ```
 *
 * Create accepts a client-supplied FULL canonical V2 snapshot. That decision is
 * frozen by 4D and retained for this cutover. Create has no `expectedVersion`
 * because there is no prior version to race against. Worker create policy —
 * distinct from payload shape — is: canonical V2 validation, `sessionId` must
 * match the authorized session, `version` must equal 1, existing-head duplicate
 * behavior retained (`SHEET_DRAFT_ALREADY_EXISTS`), immutable R2 write before
 * D1 head create, and success is the raw V2 snapshot.
 *
 * Server-authored creation (the Worker building the draft from an extraction
 * result) is explicitly OUT OF SCOPE for 4E. It is not a pending decision and
 * must not be designed opportunistically during the route migration.
 *
 * ## Frozen response policy — SETTLED, NOT OPEN
 *
 * ```text
 * create, get, mutate, confirm  ->  raw CharacterSheetDraftV2   (NO envelope)
 * reroll                        ->  { draft, rerolledKeys }
 * ```
 *
 * Confirm returns a raw snapshot. There is no `{ draft: ... }` wrapper in V2.
 * The live V1 confirm route's `{ draft: ... }` envelope is a known pre-existing
 * integration defect, corrected by 4E3B rather than here.
 *
 * ## V1 payloads are untouched
 *
 * Nothing in this module is imported by a live route. The V1 request shapes stay
 * exactly as they are until 4E5 activates the V2 runtime, and the Web client is
 * updated in lockstep before that activation.
 */
import {
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
  type SheetDraftSnapshotResponseV2,
} from "@repo/character-sheet-draft";

export {
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
};
export type {
  SheetDraftConfirmRequestV2,
  SheetDraftCreateRequestV2,
  SheetDraftMutationRequestV2,
  SheetDraftRerollRequestV2,
  SheetDraftRerollResponseV2,
  SheetDraftSnapshotResponseV2,
};

/**
 * Parse outcome for a future V2 request body: `ok` with the parsed value, or
 * `invalid`. A request-shape failure is a transport concern, so it is a value at
 * the route edge rather than a thrown `ZodError`.
 *
 * This describes request parsing only. Domain failure remains thrown.
 */
export type DraftV2RequestOutcome<T> =
  { kind: "ok"; value: T } | { kind: "invalid" };

/**
 * `{ expectedVersion, mutation }` for the future V2 mutate route.
 *
 * Both the strict envelope and the strict `DraftMutationV2` union are enforced
 * by the frozen package schema, which also rejects an `expectedVersion` placed
 * INSIDE the mutation and any extra envelope key.
 */
export function parseDraftV2MutationRequest(
  body: unknown,
): DraftV2RequestOutcome<SheetDraftMutationRequestV2> {
  const parsed = SheetDraftMutationRequestV2Schema.safeParse(body);
  return parsed.success
    ? { kind: "ok", value: parsed.data }
    : { kind: "invalid" };
}

/**
 * `{ expectedVersion, seed }` for the future V2 reroll route.
 *
 * Seed bounds match V1 exactly, so reroll seeds transfer across the cutover
 * unchanged.
 */
export function parseDraftV2RerollRequest(
  body: unknown,
): DraftV2RequestOutcome<SheetDraftRerollRequestV2> {
  const parsed = SheetDraftRerollRequestV2Schema.safeParse(body);
  return parsed.success
    ? { kind: "ok", value: parsed.data }
    : { kind: "invalid" };
}

/**
 * `{ expectedVersion }` for the future V2 confirm route.
 *
 * There is no empty-body confirm in V2: the live V1 confirm route takes no body
 * at all, which is exactly what made an unguarded confirmation possible.
 */
export function parseDraftV2ConfirmRequest(
  body: unknown,
): DraftV2RequestOutcome<SheetDraftConfirmRequestV2> {
  const parsed = SheetDraftConfirmRequestV2Schema.safeParse(body);
  return parsed.success
    ? { kind: "ok", value: parsed.data }
    : { kind: "invalid" };
}

/**
 * NOT re-exported as a parse helper on purpose: create takes a whole canonical
 * V2 draft whose payload shape IS `CharacterSheetDraftV2Schema`. The handler
 * applies the frozen create POLICY (sessionId match, `version === 1`,
 * existing-head duplicate, R2-then-D1 ordering) around that validation, so it
 * needs the schema directly rather than an opaque "valid or not" answer.
 */
