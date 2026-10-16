import { z } from "zod";
import {
  CanonicalVisualStyleSchema,
  InstructionsSchema,
  NpcInstructionsSchema,
  PortraitConfigSchema,
  ThreatLevelSchema,
} from "./final-generation-contract.js";

/**
 * Production final-generation start request (14.12).
 *
 * The route identity carries sessionId/draftId; the body carries ONLY the
 * concurrency precondition plus generation options. The Draft itself is NEVER
 * client-supplied: the server loads the authoritative Draft from D1/R2 and
 * builds the canonical FinalGenerationRequestV1 server-side.
 */
export const FinalGenerationStartRequestV1Schema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  options: z
    .strictObject({
      threat: ThreatLevelSchema.nullish(),
      visualStyle: CanonicalVisualStyleSchema,
      instructions: InstructionsSchema,
      npcInstructions: NpcInstructionsSchema,
      portrait: PortraitConfigSchema,
    })
    .strict(),
  seed: z.string().min(1).max(64),
});
export type FinalGenerationStartRequestV1 = z.infer<
  typeof FinalGenerationStartRequestV1Schema
>;

/**
 * Synchronous success response for a READY final-generation run.
 * Never carries PDF bytes or provider details.
 */
export const FinalGenerationStartResponseV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  runId: z.string().min(1).max(128),
  status: z.literal("READY"),
  draftId: z.string().min(1).max(128),
  draftVersion: z.number().int().min(1),
});
export type FinalGenerationStartResponseV1 = z.infer<
  typeof FinalGenerationStartResponseV1Schema
>;
