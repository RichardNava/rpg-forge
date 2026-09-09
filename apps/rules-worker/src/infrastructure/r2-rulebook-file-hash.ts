import { MAX_RULEBOOK_BYTES } from "@repo/rulebook-ingestion";
import type { RulebookFileHashPort } from "@repo/rules-analysis-run";
import { webCrypto } from "@repo/rules-analysis-session";
import {
  RulebookStorageUnavailableError,
  getRulebookObjectKeys,
} from "./r2-rulebook-storage.js";

/**
 * Hashes the stored rulebook PDF so the analysis run can pin its provenance to
 * a concrete document identity. The stored object is size-bounded before read.
 */
export function createR2RulebookFileHash(
  bucket: R2Bucket,
): RulebookFileHashPort {
  return {
    async hashRulebookRaw(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      let bytes: ArrayBuffer;
      try {
        const object = await bucket.get(keys.rawPdf);
        if (object === null) {
          throw new RulebookStorageUnavailableError();
        }
        if (object.size <= 0 || object.size > MAX_RULEBOOK_BYTES) {
          throw new RulebookStorageUnavailableError();
        }
        bytes = await object.arrayBuffer();
      } catch (error) {
        if (error instanceof RulebookStorageUnavailableError) {
          throw error;
        }
        throw new RulebookStorageUnavailableError();
      }
      return webCrypto.sha256Hex(new Uint8Array(bytes));
    },
  };
}
