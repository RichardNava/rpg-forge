import { z } from "zod";
import { draftError } from "./errors";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema";
import {
  draftKeyPattern,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import {
  DEFAULT_DRAFT_CONTAINER_LAYOUT_V1,
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  type DraftLayoutV1,
} from "./draft-layout-v1";
import {
  DEFAULT_PORTRAIT_ASPECT_RATIO,
  type PortraitAspectRatio,
} from "./draft-slot-v2";
import {
  MAX_PORTRAIT_SLOTS,
  PortraitAspectRatioSchema,
  type DraftSlotV1,
} from "./draft-slot-v2";
import { nextDraftVersion } from "./versioning";

const SLOT_MUTATION_KEY_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Slot keys must use safe canonical keys.");

const SLOT_MUTATION_PARENT_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_DRAFT_FIELD_KEY_CHARS)
  .regex(draftKeyPattern, "Slot parents must use safe canonical keys.")
  .nullable()
  .optional();

export const DraftAddPortraitSlotMutationV2Schema = z.strictObject({
  op: z.literal("add_portrait_slot"),
  key: SLOT_MUTATION_KEY_SCHEMA,
  parentKey: SLOT_MUTATION_PARENT_SCHEMA,
});
export type DraftAddPortraitSlotMutationV2 = z.infer<
  typeof DraftAddPortraitSlotMutationV2Schema
>;

export const DraftRemovePortraitSlotMutationV2Schema = z.strictObject({
  op: z.literal("remove_portrait_slot"),
  key: SLOT_MUTATION_KEY_SCHEMA,
});
export type DraftRemovePortraitSlotMutationV2 = z.infer<
  typeof DraftRemovePortraitSlotMutationV2Schema
>;

export const DraftSetPortraitAspectRatioMutationV2Schema = z.strictObject({
  op: z.literal("set_portrait_aspect_ratio"),
  key: SLOT_MUTATION_KEY_SCHEMA,
  aspectRatio: PortraitAspectRatioSchema,
});
export type DraftSetPortraitAspectRatioMutationV2 = z.infer<
  typeof DraftSetPortraitAspectRatioMutationV2Schema
>;

/**
 * Isolated V2 portrait-slot registry mutation contract. `op` is the
 * discriminant; `expectedVersion` is deliberately OUT of the payload (pass it
 * to the apply function instead). A slot is a structural placeholder, never a
 * Field: these mutations own the slots registry entry, its single canonical
 * structure placement, its layout node geometry and its aspect-ratio detail —
 * never image content.
 */
export const DraftSlotRegistryMutationV2Schema = z.discriminatedUnion("op", [
  DraftAddPortraitSlotMutationV2Schema,
  DraftRemovePortraitSlotMutationV2Schema,
  DraftSetPortraitAspectRatioMutationV2Schema,
]);
export type DraftSlotRegistryMutationV2 = z.infer<
  typeof DraftSlotRegistryMutationV2Schema
>;

/**
 * Parses untrusted input into a validated V2 slot registry mutation. Throws
 * `DraftError("invalid_mutation")` on rejection. Parser failures never escape
 * as ZodError.
 */
export function parseDraftSlotRegistryMutationV2(
  input: unknown,
): DraftSlotRegistryMutationV2 {
  const result = DraftSlotRegistryMutationV2Schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw draftError(
      "invalid_mutation",
      first === undefined
        ? "The slot registry mutation is invalid."
        : `The slot registry mutation is invalid: ${first.message}`,
    );
  }
  return result.data;
}

/**
 * Applies one validated V2 slot registry mutation to a canonical V2 draft.
 *
 * Precondition order mirrors the other registry families:
 * 1. `expectedVersion === draft.version` (version_conflict wins)
 * 2. confirmed guard (draft_confirmed)
 * 3. mutation-specific validation
 * 4. semantic no-op detection (unchanged aspect ratio returns the original)
 * 5. immutable atomic change (slots[] + structure[] + layout stay in sync)
 * 6. version bumped exactly once via `nextDraftVersion`
 * 7. `baseVersion` preserved
 * 8. `validateDraftV2` used as a validation GATE
 */
export function applyDraftSlotRegistryMutationWithExpectedVersionV2(
  draft: CharacterSheetDraftV2,
  mutation: DraftSlotRegistryMutationV2,
  expectedVersion: number,
): CharacterSheetDraftV2 {
  assertMatchingVersion(draft, expectedVersion);
  assertV2Editable(draft);

  switch (mutation.op) {
    case "add_portrait_slot":
      return applyAddPortraitSlot(draft, mutation);
    case "remove_portrait_slot":
      return applyRemovePortraitSlot(draft, mutation);
    case "set_portrait_aspect_ratio":
      return applySetPortraitAspectRatio(draft, mutation);
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

function applyAddPortraitSlot(
  draft: CharacterSheetDraftV2,
  mutation: DraftAddPortraitSlotMutationV2,
): CharacterSheetDraftV2 {
  const slots = draft.slots ?? [];
  if (slots.some((entry) => entry.key === mutation.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft slot "${mutation.key}" already exists.`,
    );
  }
  if (draft.fields.some((field) => field.key === mutation.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft slot key "${mutation.key}" collides with an existing field.`,
    );
  }
  if (draft.sections.some((section) => section.key === mutation.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft slot key "${mutation.key}" collides with an existing section.`,
    );
  }
  if (slots.length >= MAX_PORTRAIT_SLOTS) {
    throw draftError(
      "invalid_mutation",
      `A draft may contain at most ${MAX_PORTRAIT_SLOTS} portrait slot.`,
    );
  }
  const parentKey = mutation.parentKey ?? null;
  if (parentKey !== null) {
    const parent = draft.sections.find((entry) => entry.key === parentKey);
    if (parent === undefined) {
      throw draftError(
        "invalid_mutation",
        `Portrait slot parent "${parentKey}" is not a Section. Only Root or a Section is a valid parent.`,
      );
    }
  }

  const slot: DraftSlotV1 = { key: mutation.key, type: "portrait" };
  const newPlacement: DraftPlacement = {
    kind: "slot",
    key: mutation.key,
    parentKey,
  };
  return commitV2(draft, {
    ...draft,
    slots: [...slots, slot],
    structure: [...draft.structure, newPlacement],
    layout: withAddedSlotLayout(draft.layout, mutation.key),
  });
}

function applyRemovePortraitSlot(
  draft: CharacterSheetDraftV2,
  mutation: DraftRemovePortraitSlotMutationV2,
): CharacterSheetDraftV2 {
  const slots = draft.slots ?? [];
  const slotIndex = slots.findIndex((entry) => entry.key === mutation.key);
  if (slotIndex === -1) {
    throw draftError(
      "invalid_mutation",
      `Draft slot "${mutation.key}" does not exist.`,
    );
  }

  let layout = draft.layout;
  if (layout !== undefined) {
    const nodes = { ...layout.nodes };
    delete nodes[mutation.key];
    const slotDetails = { ...(layout.slotDetails ?? {}) };
    delete slotDetails[mutation.key];
    layout =
      Object.keys(slotDetails).length === 0
        ? {
            schemaVersion: layout.schemaVersion,
            root: layout.root,
            sections: { ...layout.sections },
            nodes,
          }
        : {
            ...layout,
            sections: { ...layout.sections },
            nodes,
            slotDetails,
          };
  }

  return commitV2(draft, {
    ...draft,
    slots: slots.filter((entry) => entry.key !== mutation.key),
    structure: draft.structure.filter(
      (placement) =>
        !(placement.kind === "slot" && placement.key === mutation.key),
    ),
    layout,
  });
}

function applySetPortraitAspectRatio(
  draft: CharacterSheetDraftV2,
  mutation: DraftSetPortraitAspectRatioMutationV2,
): CharacterSheetDraftV2 {
  const slots = draft.slots ?? [];
  if (!slots.some((entry) => entry.key === mutation.key)) {
    throw draftError(
      "invalid_mutation",
      `Draft slot "${mutation.key}" does not exist.`,
    );
  }
  const current = currentAspectRatio(draft, mutation.key);
  if (current === mutation.aspectRatio) {
    return draft;
  }
  const layout = draft.layout === undefined ? undefined : { ...draft.layout };
  if (layout !== undefined) {
    layout.slotDetails = {
      ...(layout.slotDetails ?? {}),
      [mutation.key]: { aspectRatio: mutation.aspectRatio },
    };
  }
  return commitV2(draft, { ...draft, layout });
}

function currentAspectRatio(
  draft: CharacterSheetDraftV2,
  key: string,
): PortraitAspectRatio | null {
  const detail = draft.layout?.slotDetails?.[key];
  return detail === undefined ? null : detail.aspectRatio;
}

/**
 * Layout maintenance for add_portrait_slot: an explicit layout gains the
 * default node entry plus the default 3:4 slot detail; a layoutless draft
 * stays layoutless (never partial), mirroring the field/section families.
 */
function withAddedSlotLayout(
  layout: DraftLayoutV1 | undefined,
  key: string,
): DraftLayoutV1 | undefined {
  if (layout === undefined) {
    return undefined;
  }
  return {
    ...layout,
    sections: { ...layout.sections },
    nodes: { ...layout.nodes, [key]: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 } },
    slotDetails: {
      ...(layout.slotDetails ?? {}),
      [key]: { aspectRatio: DEFAULT_PORTRAIT_ASPECT_RATIO },
    },
  };
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
