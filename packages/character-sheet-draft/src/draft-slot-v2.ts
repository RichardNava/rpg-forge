import { z } from "zod";
import { MAX_DRAFT_FIELD_KEY_CHARS } from "./draft-schema.ts";

/**
 * Canonical key grammar, intentionally local (not imported) so this module
 * has no runtime dependency on the draft schema modules — `draft-schema-v2`
 * imports this module's schemas, and a value import back would be a module
 * evaluation cycle. The pattern mirrors the canonical key grammar exactly.
 */
const slotKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * Portrait Slot registry record (14.13).
 *
 * A Slot is a structural placeholder, NOT a Field: it carries no label, no
 * value, no options, no bounds. Its geometry lives in the generic
 * DraftLayoutV1 node entry; its aspect lives in `layout.slotDetails`. Image
 * content lives in the temporary session portrait-asset layer and is never
 * part of the Draft.
 */
export const DraftSlotV1Schema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(MAX_DRAFT_FIELD_KEY_CHARS)
    .regex(slotKeyPattern, "Slot keys must use safe canonical keys."),
  type: z.literal("portrait"),
});
export type DraftSlotV1 = z.infer<typeof DraftSlotV1Schema>;

/**
 * Portrait Slot aspect ratio. Bounded strict enum; the default for a newly
 * created portrait slot is "3:4".
 */
export const PortraitAspectRatioSchema = z.enum(["1:1", "3:4", "4:5", "16:9"]);
export type PortraitAspectRatio = z.infer<typeof PortraitAspectRatioSchema>;

export const DEFAULT_PORTRAIT_ASPECT_RATIO: PortraitAspectRatio = "3:4";

/**
 * Slot-only spatial metadata, keyed by slot key. Aspect ratio is layout
 * metadata (presentation of the frame), never image content.
 */
export const SlotDetailsV1Schema = z.strictObject({
  aspectRatio: PortraitAspectRatioSchema,
});
export type SlotDetailsV1 = z.infer<typeof SlotDetailsV1Schema>;

/** Maximum portrait Slots per draft in 14.13. */
export const MAX_PORTRAIT_SLOTS = 1 as const;
