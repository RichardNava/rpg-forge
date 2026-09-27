import { z } from "zod";
import { applyDraftNodePlacementWithExpectedVersionV2 } from "./draft-node-placement-concurrent";
import { type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { draftError } from "./errors";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import { draftKeyPattern } from "./draft-schema-v2";
import {
  DraftNodeDestinationSchema,
  type DraftNodeDestination,
} from "./draft-structure-placement-plan";

/**
 * Formal V2 mutation command: place_node
 *
 * Moves an existing Field or Section node to a new structural position.
 * The node kind (Field vs Section) is resolved at application time.
 */
export const DraftPlaceNodeMutationV2Schema = z.strictObject({
  op: z.literal("place_node"),
  key: z.string().min(1).max(MAX_DRAFT_FIELD_KEY_CHARS).regex(draftKeyPattern),
  destination: DraftNodeDestinationSchema,
});
export type DraftPlaceNodeMutationV2 = z.infer<
  typeof DraftPlaceNodeMutationV2Schema
>;

/**
 * Current V2 mutation contract — only place_node is supported.
 * Future slices will extend this discriminated union.
 */
export const DraftMutationV2Schema = z.discriminatedUnion("op", [
  DraftPlaceNodeMutationV2Schema,
]);
export type DraftMutationV2 = z.infer<typeof DraftMutationV2Schema>;

/**
 * Parses an unknown input into a validated V2 mutation command.
 *
 * @param input - Untrusted input to parse
 * @returns Typed DraftMutationV2
 * @throws DraftError("invalid_mutation") on parse failure
 */
export function parseDraftMutationV2(input: unknown): DraftMutationV2 {
  const result = DraftMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The V2 mutation is invalid."
        : `The V2 mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies a typed V2 mutation to a draft snapshot.
 *
 * This is the formal V2 mutation dispatcher. It delegates structural
 * placement semantics entirely to the approved 2B2 API, which in turn
 * uses the complete 2A structural stack.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param mutation - Typed V2 mutation (already validated by parseDraftMutationV2)
 * @param expectedVersion - Optimistic concurrency precondition
 * @returns New validated V2 draft (version bumped by 2B2 if real change)
 */
export function applyDraftMutationV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  // Dispatch on mutation op — currently only place_node
  if (mutation.op === "place_node") {
    return applyDraftNodePlacementWithExpectedVersionV2(
      draft,
      mutation.key,
      mutation.destination,
      expectedVersion,
    );
  }

  // Unreachable while place_node is the only supported op. Future ops must
  // extend DraftMutationV2Schema and add a dispatch branch above.
  throw draftError("invalid_mutation", "Unsupported V2 mutation op.");
}
