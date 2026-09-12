import {
  getInstructionExtractionJsonSchema,
  type InstructionExtractionPort,
} from "@repo/character-sheet-generation";
import { AUTHORIZED_MODEL } from "./config.js";
import type { ExtractionCallRecord } from "./scoring.js";

export interface RemoteCallMetadata {
  readonly finishReason: string | null;
  readonly usage: unknown;
}

/** Benchmark-only optional extension read by the recording port. */
export interface InstructionExtractionPortWithMetadata extends InstructionExtractionPort {
  readonly lastMetadata: RemoteCallMetadata | null;
}

/**
 * Calls the extraction shim worker (localhost dev server) with the real 2C2A
 * system prompt, user prompt and canonical extraction JSON schema in the same
 * message shape the production extraction adapter would produce.
 */
export class RemoteInstructionExtractionPort implements InstructionExtractionPortWithMetadata {
  lastMetadata: RemoteCallMetadata | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string = AUTHORIZED_MODEL,
  ) {}

  async generate(args: { system: string; user: string }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        system: args.system,
        user: args.user,
        schema: getInstructionExtractionJsonSchema(),
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      readonly success?: unknown;
      readonly text?: unknown;
      readonly error?: unknown;
      readonly finishReason?: unknown;
      readonly usage?: unknown;
    } | null;

    if (!response.ok || body?.success !== true || body === null) {
      const detail =
        body?.error === undefined || body === null
          ? "Unknown extraction shim error"
          : String(body.error);
      throw new Error(`Instruction extraction failed: ${detail}`);
    }
    if (typeof body.text !== "string" || body.text.length === 0) {
      throw new Error("Instruction extraction returned no usable text.");
    }
    this.lastMetadata = {
      finishReason:
        typeof body.finishReason === "string" ? body.finishReason : null,
      usage: body.usage ?? null,
    };
    return body.text;
  }
}

/**
 * Records every provider call, its elapsed time and structured attempt
 * metadata so the report can show first-attempt vs replay behavior without
 * guessing from call totals.
 */
export class RecordingInstructionExtractionPort implements InstructionExtractionPort {
  readonly calls: ExtractionCallRecord[] = [];

  constructor(private readonly inner: InstructionExtractionPort) {}

  async generate(args: { system: string; user: string }): Promise<string> {
    const attemptNumber = this.calls.length + 1;
    const startedAt = performance.now();
    const metadata = readMetadata(this.inner);

    try {
      const raw = await this.inner.generate(args);
      this.calls.push({
        attemptNumber,
        isCorrectionReplay: attemptNumber > 1,
        system: args.system,
        user: args.user,
        raw,
        error: null,
        finishReason: metadata?.finishReason ?? null,
        usage: metadata?.usage ?? null,
        elapsedMs: roundMs(performance.now() - startedAt),
      });
      return raw;
    } catch (error) {
      this.calls.push({
        attemptNumber,
        isCorrectionReplay: attemptNumber > 1,
        system: args.system,
        user: args.user,
        raw: "",
        error: {
          name: error instanceof Error ? error.name : "Unknown",
          message:
            error instanceof Error ? error.message : "Unknown provider error",
        },
        finishReason: metadata?.finishReason ?? null,
        usage: metadata?.usage ?? null,
        elapsedMs: roundMs(performance.now() - startedAt),
      });
      throw error;
    }
  }
}

function readMetadata(
  port: InstructionExtractionPort,
): RemoteCallMetadata | null {
  const metadata = (port as Partial<InstructionExtractionPortWithMetadata>)
    .lastMetadata;
  return metadata === undefined || metadata === null ? null : metadata;
}

function roundMs(elapsed: number): number {
  return Math.round(elapsed * 100) / 100;
}
