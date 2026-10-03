/**
 * 4E3A-R — INTERNAL V2 HTTP egress serialization (not wired to any route).
 *
 * ## Scope
 *
 * This module owns exactly one concern: turning a successful V2 domain result
 * into an HTTP success `Response` that is validated against the FROZEN package
 * contract before it leaves the Worker.
 *
 * ## What was removed, and why
 *
 * An earlier revision of this module contained `runDraftV2Operation`,
 * `draftErrorV2Response` and a `DraftV2Outcome` union. All three existed only
 * because the 4E3 audit wrongly claimed that V2 domain operations return
 * discriminated error-result unions. They do not:
 *
 * - `applyDraftMutationV2(draft, mutation, expectedVersion)` RETURNS a canonical
 *   `CharacterSheetDraftV2` and THROWS `DraftError` on rejection, including
 *   `version_conflict` from its `expectedVersion` precondition.
 * - `finalizeDraftV2(draft)` RETURNS a canonical V2 draft and THROWS
 *   `draftError("draft_confirmed")`.
 * - `rerollLockedDraftValuesV2(draft, seed)` RETURNS `{ draft, rerolledKeys }` —
 *   a success payload, not an error union — and THROWS `draftError("draft_confirmed")`.
 *
 * V2 therefore keeps V1's throw-based domain failure channel, and the preferred
 * future handler shape stays exactly what V1 already uses:
 *
 * ```text
 * try   { parse strict V2 request; const draft = applyDraftMutationV2(...); ... }
 * catch (error) { return draftErrorToResponse(error); }
 * ```
 *
 * `draftErrorToResponse` stays PRIVATE in `character-sheet-handler.ts` and is
 * deliberately NOT duplicated or extracted here: it already owns the
 * `DraftError` -> HTTP translation for the whole character-sheet surface, and a
 * second mapper would be a second taxonomy that could silently drift. D1 claim
 * outcomes are handled explicitly in the handler because those are repository
 * result values, not domain failures.
 *
 * ## What remains here
 *
 * Only the success-path serializers. Both validate against the frozen
 * `@repo/character-sheet-draft` response schemas, so a non-canonical draft can
 * never be emitted to a client. That egress assertion is the Worker-specific
 * part; the response SHAPE is owned by the package.
 *
 * ## Deliberately NOT here
 *
 * - No version bumping. `bumpDraftVersionV2` is never called; V2 domain
 *   lifecycle owns the resulting version, and a second bump would skip a
 *   version and corrupt the D1 head CAS.
 * - No no-op detection. A semantic no-op returns the EXACT original snapshot
 *   with an unchanged version. These serializers pass any snapshot through
 *   without touching `version`, so the no-op distinction stays observable to the
 *   handler, which is where the "no claim, no R2 write" bypass belongs.
 *
 * ## Live since the 4E5 cutover
 *
 * The live character-sheet handlers import these serializers for every
 * success response.
 */
import {
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
  type DraftRerollResultV2,
} from "@repo/character-sheet-draft";
import { jsonResponse } from "../../transport/errors.js";

/**
 * Success response for a V2 draft snapshot: the RAW canonical V2 draft with no
 * envelope, per the frozen 4D response policy.
 *
 * This is the deliberate correction to the old V1 confirm route, which wrapped
 * the draft as `{ draft: ... }`. That wrapper was a pre-existing integration
 * defect; the 4E5 cutover made the raw snapshot live.
 *
 * The frozen schema is applied first, so a snapshot that is not canonical V2
 * fails loudly here instead of reaching a client. That is a programmer defect,
 * not a client condition, so it is deliberately NOT translated into a 4xx.
 */
export function draftV2SnapshotResponse(body: unknown): Response {
  return jsonResponse(200, SheetDraftSnapshotResponseV2Schema.parse(body));
}

/**
 * Success response for a V2 create: the RAW canonical V2 draft with no
 * envelope, per the frozen 4D response policy, with HTTP 201 Created.
 *
 * The frozen schema is applied first, so a snapshot that is not canonical V2
 * fails loudly here instead of reaching a client. That is a programmer defect,
 * not a client condition, so it is deliberately NOT translated into a 4xx.
 */
export function draftV2CreatedResponse(body: unknown): Response {
  return jsonResponse(201, SheetDraftSnapshotResponseV2Schema.parse(body));
}

/**
 * Success response for a V2 reroll: the snapshot plus the keys it rerolled.
 *
 * Reroll is the one WRAPPED V2 draft response, because it reports information a
 * bare snapshot cannot carry. The body matches the frozen
 * `SheetDraftRerollResponseV2Schema` and the live V1 reroll response shape, so
 * the client contract for reroll does not change at the cutover.
 *
 * `DraftRerollResultV2` is a SUCCESS payload, not an error union: it is what
 * `rerollLockedDraftValuesV2` returns before the domain throws
 * `draft_confirmed`.
 */
export function draftV2RerollResponse(result: DraftRerollResultV2): Response {
  return jsonResponse(
    200,
    SheetDraftRerollResponseV2Schema.parse({
      draft: result.draft,
      rerolledKeys: result.rerolledKeys,
    }),
  );
}
