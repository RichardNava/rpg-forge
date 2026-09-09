import {
  RulebookChunkSchema,
  type RulebookChunk,
} from "@repo/rulebook-ingestion";
import type { ChunkSourcePort } from "@repo/rules-analysis-run";
import {
  RulebookStorageUnavailableError,
  getRulebookObjectKeys,
} from "./r2-rulebook-storage.js";

/**
 * Reads the rulebook's `chunks.jsonl` extraction artifact. The chunk files were
 * validated at write time, but they are re-validated per line here because the
 * chunk source is untrusted storage data.
 */
export function createR2ChunkSource(bucket: R2Bucket): ChunkSourcePort {
  return {
    async readChunks(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      let text: string;
      try {
        const object = await bucket.get(keys.chunks);
        if (object === null) {
          throw new RulebookStorageUnavailableError();
        }
        text = await object.text();
      } catch (error) {
        if (error instanceof RulebookStorageUnavailableError) {
          throw error;
        }
        throw new RulebookStorageUnavailableError();
      }

      const chunks: RulebookChunk[] = [];
      for (const line of text.split("\n")) {
        if (line.length === 0) {
          continue;
        }
        try {
          chunks.push(RulebookChunkSchema.parse(JSON.parse(line) as unknown));
        } catch {
          throw new RulebookStorageUnavailableError();
        }
      }
      return chunks;
    },
  };
}
