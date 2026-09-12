import { z } from "zod";
import { AuthoredFieldLabelSchema } from "./authoring.js";
import {
  CanonicalFieldKeySchema,
  FieldCategorySchema,
  ProposedSheetOverrideSchema,
} from "./source-resolution.js";
import {
  MAX_INSTRUCTION_NAME_CHARS,
  NpcPortraitIntentSchema,
  ProposedGenerationInstructionSchema,
} from "./instructions.js";
import {
  MAX_EXTRACTED_INSTRUCTIONS,
  MAX_EXTRACTION_DIAGNOSTICS,
  MAX_EXTRACTION_DIAGNOSTIC_DETAIL_CHARS,
} from "./model.js";

/**
 * Grounding context the model receives for disambiguation only. Field labels
 * and canonical keys are presented as already established by the deterministic
 * compiler; the model must never mint new keys or invent bounds.
 */
export const ExtractionFieldContextSchema = z.strictObject({
  label: AuthoredFieldLabelSchema,
  category: FieldCategorySchema,
  canonicalKey: CanonicalFieldKeySchema,
});
export type ExtractionFieldContext = z.infer<
  typeof ExtractionFieldContextSchema
>;

/**
 * Diagnostics are model- or pipeline-emitted notes explaining why part of the
 * raw `contextInstructions` did not convert into proposals. They never block
 * the pipeline; they explain what was intentionally dropped.
 */
export const InstructionExtractionDiagnosticSchema = z.strictObject({
  code: z.enum(["unsupported-instruction", "target-not-actionable"]),
  detail: z
    .string()
    .max(MAX_EXTRACTION_DIAGNOSTIC_DETAIL_CHARS)
    .regex(/\S/)
    .optional(),
});
export type InstructionExtractionDiagnostic = z.infer<
  typeof InstructionExtractionDiagnosticSchema
>;

/**
 * Raw output contract for the instruction-extraction provider call. Model
 * diagnostics are advisory; pipeline-side gating diagnostics are appended
 * deterministically by the app, never trusted from the model.
 */
export const InstructionExtractionOutputSchema = z.strictObject({
  instructions: z
    .array(ProposedGenerationInstructionSchema)
    .max(MAX_EXTRACTED_INSTRUCTIONS),
  diagnostics: z
    .array(InstructionExtractionDiagnosticSchema)
    .max(MAX_EXTRACTION_DIAGNOSTICS)
    .default([]),
});
export type InstructionExtractionOutput = z.infer<
  typeof InstructionExtractionOutputSchema
>;

/**
 * Normalized pipeline result. `proposedInstructions` re-validates and types
 * the raw output instructions; `diagnostics` merges model diagnostics with
 * deterministic pipeline gating diagnostics in stable order.
 */
export const InstructionExtractionResultSchema = z.strictObject({
  proposedInstructions: z
    .array(ProposedGenerationInstructionSchema)
    .max(MAX_EXTRACTED_INSTRUCTIONS),
  diagnostics: z.array(InstructionExtractionDiagnosticSchema),
});
export type InstructionExtractionResult = z.infer<
  typeof InstructionExtractionResultSchema
>;

/**
 * The emitted/input-side contract shown to the model. `ProposedGeneration
 * InstructionSchema` trims the character name via a transform, which zod
 * cannot serialize to JSON Schema; this variant mirrors the exact raw JSON the
 * model must produce (whitespace in `value` is tolerated and normalized by the
 * server-side transform during validation).
 */
const SetCharacterNameEmittedSchema = z.strictObject({
  op: z.literal("set_character_name"),
  value: z.string().max(MAX_INSTRUCTION_NAME_CHARS),
});

export const InstructionExtractionOutputInputSchema = z.strictObject({
  instructions: z
    .discriminatedUnion("op", [
      z.strictObject({
        op: z.literal("field"),
        override: ProposedSheetOverrideSchema,
      }),
      SetCharacterNameEmittedSchema,
      z.strictObject({
        op: z.literal("request_npc_portrait"),
        intent: NpcPortraitIntentSchema,
      }),
    ])
    .array()
    .max(MAX_EXTRACTED_INSTRUCTIONS),
  diagnostics: z
    .array(InstructionExtractionDiagnosticSchema)
    .max(MAX_EXTRACTION_DIAGNOSTICS)
    .default([]),
});

export function getInstructionExtractionJsonSchema() {
  return z.toJSONSchema(InstructionExtractionOutputInputSchema, {
    reused: "ref",
  });
}
