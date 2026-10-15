import {
  PortraitGenerationPromptSchema,
  validatePortraitImageBytes,
  type PortraitGenerationInput,
  type PortraitGenerationPort,
  type PortraitGenerationResult,
  PortraitGenerationError,
} from "@repo/character-sheet-portraits";

/**
 * Approved default portrait image size (square-ish source; the renderer
 * contain-fits it into the slot frame without distortion).
 */
export const PORTRAIT_IMAGE_EDGE_PIXELS = 512;

/**
 * Create a Cloudflare Workers AI text-to-image adapter implementing the
 * narrow PortraitGenerationPort.
 *
 * The model receives only the user's portrait description plus small trusted
 * visual guidance. It never receives Draft structure, mechanical values,
 * session tokens, or R2 keys, and it can never modify a Draft.
 *
 * @param ai - The Cloudflare Ai binding from the Worker environment.
 * @param model - Explicit model name (from `env.SHEET_PORTRAIT_MODEL`).
 */
export function createCloudflarePortraitGeneration(
  ai: Ai,
  model: string,
): PortraitGenerationPort {
  return {
    async generate(input: PortraitGenerationInput): Promise<PortraitGenerationResult> {
      const promptParsed = PortraitGenerationPromptSchema.safeParse(input.prompt);
      if (!promptParsed.success) {
        throw new PortraitGenerationError(
          "INVALID_OUTPUT",
          "The portrait description is invalid.",
        );
      }
      const guided = [
        "Tabletop RPG character portrait, single subject, bust composition, neutral background.",
        input.styleContext !== null && input.styleContext.trim() !== ""
          ? `Style guidance: ${input.styleContext.trim().slice(0, 200)}.`
          : null,
        `Subject: ${promptParsed.data}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" ");

      let stream: unknown;
      try {
        stream = await ai.run(model, {
          prompt: guided,
          width: PORTRAIT_IMAGE_EDGE_PIXELS,
          height: PORTRAIT_IMAGE_EDGE_PIXELS,
        });
      } catch {
        throw new PortraitGenerationError(
          "PROVIDER_UNAVAILABLE",
          "The portrait image provider is unavailable.",
        );
      }

      const bytes = await readImageStream(stream);
      if (bytes === null) {
        throw new PortraitGenerationError(
          "PROVIDER_UNAVAILABLE",
          "The portrait image provider returned no image.",
        );
      }
      const validated = validatePortraitImageBytes(bytes);
      if (!validated.valid || validated.mimeType === null) {
        throw new PortraitGenerationError(
          "INVALID_OUTPUT",
          "The portrait image provider returned invalid image bytes.",
        );
      }
      return { bytes, mimeType: validated.mimeType };
    },
  };
}

async function readImageStream(stream: unknown): Promise<Uint8Array | null> {
  try {
    if (stream instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value !== undefined) chunks.push(next.value);
      }
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (total === 0) return null;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    }
    if (stream instanceof Uint8Array) {
      return stream.length === 0 ? null : stream;
    }
    if (stream instanceof ArrayBuffer) {
      return stream.byteLength === 0 ? null : new Uint8Array(stream);
    }
  } catch {
    return null;
  }
  return null;
}
