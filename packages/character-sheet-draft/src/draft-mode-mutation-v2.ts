import { z } from "zod";
import { draftError } from "./errors";
import {
  MAX_DRAFT_FIELD_KEY_CHARS,
} from "./draft-schema";
import {
  type CharacterSheetDraftV2,
} from "./draft-schema-v2";
import { nextDraftVersion } from "./versioning";
import { validateDraftV2 } from "./draft-schema-v2";

const modeMutationKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(pc|npc)$/, "Mode must be 'pc' or 'npc'.");

const DraftSetModeMutationV2Schema = z.strictObject({
  op: z.literal("set_mode"),
  mode: z.enum(["pc", "npc"]),
});
export type DraftSetModeMutationV2 = z.infer<typeof DraftSetModeMutationV2Schema>;

export const DraftModeMutationV2Schema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set_mode"),
    mode: z.enum(["pc", "npc"]),
  }),
]);
export type DraftModeMutationV2 = z.infer<typeof DraftModeMutationV2Schema>;

export function parseDraftModeMutationV2(input: unknown): DraftModeMutationV2 {
  const result = DraftModeMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The mode mutation is invalid."
        : `The mode mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
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

function applySetMode(
  draft: CharacterSheetDraftV2,
  mutation: { op: "set_mode"; mode: "pc" | "npc" },
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  const currentMode = draft.mode;
  const newMode = mutation.mode;

  if (currentMode === newMode) {
    return draft;
  }

  return commitV2(draft, {
    ...draft,
    mode: newMode,
  });
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

export function applyDraftModeMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: { op: "set_mode"; mode: "pc" | "npc" },
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  return applySetMode(draft, mutation, expectedVersion);
}