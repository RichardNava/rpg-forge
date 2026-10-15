import { z } from "zod";
import type { PortraitMimeType } from "./image-validation.js";

/**
 * Narrow provider-agnostic portrait image generation port (14.13).
 *
 * The model receives only the user's portrait description plus small trusted
 * visual guidance. It never receives Draft structure, mechanical values,
 * session tokens, or R2 keys, and it can never modify a Draft.
 */
export const PortraitGenerationPromptSchema = z
  .string()
  .trim()
  .min(1, "A portrait description is required.")
  .max(2000, "Portrait descriptions are limited to 2000 characters.");
export type PortraitGenerationPrompt = z.infer<typeof PortraitGenerationPromptSchema>;

export interface PortraitGenerationInput {
  /** Untrusted user portrait description (validated, bounded). */
  readonly prompt: string;
  /** Small trusted visual guidance, e.g. the chosen presentation style. */
  readonly styleContext: string | null;
}

export interface PortraitGenerationResult {
  readonly bytes: Uint8Array;
  readonly mimeType: PortraitMimeType;
}

export interface PortraitGenerationPort {
  generate(input: PortraitGenerationInput): Promise<PortraitGenerationResult>;
}

export class PortraitGenerationError extends Error {
  readonly code: "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT";
  constructor(code: "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT", message: string) {
    super(message);
    this.name = "PortraitGenerationError";
    this.code = code;
  }
}
