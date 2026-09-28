import { z } from "zod";
import {
  applyDraftContentMutationWithExpectedVersionV2,
  DraftContentMutationV2Schema,
  parseDraftContentMutationV2,
} from "./draft-content-mutation-v2";
import {
  applyDraftFieldRegistryMutationWithExpectedVersionV2,
  DraftFieldRegistryMutationV2Schema,
  parseDraftFieldRegistryMutationV2,
} from "./draft-field-registry-mutation-v2";
import {
  applyDraftSectionRegistryMutationWithExpectedVersionV2,
  DraftSectionRegistryMutationV2Schema,
  parseDraftSectionRegistryMutationV2,
} from "./draft-section-registry-mutation-v2";
import { applyDraftNodePlacementWithExpectedVersionV2 } from "./draft-node-placement-concurrent";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import { draftKeyPattern, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftNodeDestinationSchema } from "./draft-structure-placement-plan";
import { draftError } from "./errors";

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
 * Unified V2 mutation contract — the canonical discriminated union.
 *
 * The eleven operations are composed from the approved primitives:
 * - place_node: structural placement (2B)
 * - set_value, clear_value, set_field_label, set_field_type, lock_field,
 *   unlock_field: content/value mutations (4A1)
 * - add_field, remove_field: field registry mutations (4A2)
 * - add_section, rename_section: section registry mutations (4A3)
 *
 * `expectedVersion` is deliberately OUT of the payload; pass it to
 * applyDraftMutationV2 instead.
 */
export const DraftMutationV2Schema = z.discriminatedUnion("op", [
  DraftPlaceNodeMutationV2Schema,
  ...DraftContentMutationV2Schema.options,
  ...DraftFieldRegistryMutationV2Schema.options,
  ...DraftSectionRegistryMutationV2Schema.options,
]);
export type DraftMutationV2 = z.infer<typeof DraftMutationV2Schema>;

/**
 * Parses an unknown input into a validated V2 mutation command.
 *
 * The unified schema narrows by `op`; family parsers then re-validate each
 * operation against its approved primitive contract (for example add_field
 * field definitions are checked against DraftFieldSchema).
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
  const mutation = result.data;
  switch (mutation.op) {
    case "place_node":
      return mutation;
    case "set_value":
    case "clear_value":
    case "set_field_label":
    case "set_field_type":
    case "lock_field":
    case "unlock_field":
      return parseDraftContentMutationV2(mutation);
    case "add_field":
    case "remove_field":
      return parseDraftFieldRegistryMutationV2(mutation);
    case "add_section":
    case "rename_section":
      return parseDraftSectionRegistryMutationV2(mutation);
    default:
      return assertNeverV2Mutation(mutation);
  }
}

/**
 * Applies a typed V2 mutation to a draft snapshot.
 *
 * This is the formal V2 mutation dispatcher. It owns the discriminant routing
 * only; every operation is delegated to its approved primitive, which owns
 * expectedVersion preconditions, the confirmed guard, domain validation,
 * semantic no-ops, immutable updates, the single version bump, baseVersion
 * preservation and the final validateDraftV2 gate.
 *
 * @param draft - The canonical V2 draft (must already be valid V2)
 * @param mutation - Typed V2 mutation (already validated by parseDraftMutationV2)
 * @param expectedVersion - Optimistic concurrency precondition
 * @returns New validated V2 draft (version bumped by the primitive if real change)
 */
export function applyDraftMutationV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  switch (mutation.op) {
    case "place_node":
      return applyDraftNodePlacementWithExpectedVersionV2(
        draft,
        mutation.key,
        mutation.destination,
        expectedVersion,
      );
    case "set_value":
    case "clear_value":
    case "set_field_label":
    case "set_field_type":
    case "lock_field":
    case "unlock_field":
      return applyDraftContentMutationWithExpectedVersionV2(
        draft,
        mutation,
        expectedVersion,
      );
    case "add_field":
    case "remove_field":
      return applyDraftFieldRegistryMutationWithExpectedVersionV2(
        draft,
        mutation,
        expectedVersion,
      );
    case "add_section":
    case "rename_section":
      return applyDraftSectionRegistryMutationWithExpectedVersionV2(
        draft,
        mutation,
        expectedVersion,
      );
    default:
      return assertNeverV2Mutation(mutation);
  }
}

function assertNeverV2Mutation(mutation: never): never {
  throw draftError("invalid_mutation", "Unsupported V2 mutation op.");
}
