import {
  RulebookUploadError,
  serializeExtractionArtifact,
  type RulebookBinarySource,
  type TemporaryRulebookStoragePort,
} from "@repo/rulebook-ingestion";

export interface RulebookObjectKeys {
  rawPdf: string;
  extraction: string;
  chunks: string;
}

export function getRulebookObjectKeys(
  analysisId: string,
  ingestionId: string,
): RulebookObjectKeys {
  const prefix = `temp/rules/${analysisId}/${ingestionId}`;
  return {
    rawPdf: `${prefix}/raw.pdf`,
    extraction: `${prefix}/extraction.json`,
    chunks: `${prefix}/chunks.jsonl`,
  };
}

export class RulebookStorageUnavailableError extends Error {
  constructor() {
    super("Rulebook storage is unavailable.");
    this.name = "RulebookStorageUnavailableError";
  }
}

export function createR2TemporaryRulebookStorage(
  bucket: R2Bucket,
): TemporaryRulebookStoragePort {
  return {
    async putRaw(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      try {
        const bytes = await collectBytes(input.bytes);
        await bucket.put(keys.rawPdf, bytes, {
          httpMetadata: { contentType: "application/pdf" },
        });
      } catch (error) {
        if (error instanceof RulebookUploadError) {
          throw error;
        }
        throw new RulebookStorageUnavailableError();
      }
    },

    async openRaw(input): Promise<RulebookBinarySource> {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      let object: R2Object | null;
      try {
        object = await bucket.head(keys.rawPdf);
      } catch {
        throw new RulebookStorageUnavailableError();
      }
      if (object === null) {
        throw new RulebookStorageUnavailableError();
      }

      return {
        sizeBytes: object.size,
        async readRange(offset: number, length: number): Promise<Uint8Array> {
          if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            offset < 0 ||
            length <= 0 ||
            offset >= object.size
          ) {
            throw new RulebookStorageUnavailableError();
          }
          const boundedLength = Math.min(length, object.size - offset);
          try {
            const range = await bucket.get(keys.rawPdf, {
              range: { offset, length: boundedLength },
            });
            if (range === null) {
              throw new RulebookStorageUnavailableError();
            }
            return await range.bytes();
          } catch (error) {
            if (error instanceof RulebookStorageUnavailableError) {
              throw error;
            }
            throw new RulebookStorageUnavailableError();
          }
        },
      };
    },

    async putExtraction(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      try {
        await bucket.put(
          keys.extraction,
          serializeExtractionArtifact(input.artifact),
          {
            httpMetadata: { contentType: "application/json" },
          },
        );
      } catch {
        throw new RulebookStorageUnavailableError();
      }
    },

    async putChunks(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      try {
        await bucket.put(keys.chunks, input.jsonl, {
          httpMetadata: { contentType: "application/x-ndjson" },
        });
      } catch {
        throw new RulebookStorageUnavailableError();
      }
    },

    async deleteArtifacts(input) {
      const keys = getRulebookObjectKeys(input.analysisId, input.ingestionId);
      try {
        await bucket.delete([keys.rawPdf, keys.extraction, keys.chunks]);
      } catch {
        throw new RulebookStorageUnavailableError();
      }
    },
  };
}

/**
 * R2 requires a known-length body. `putRaw` receives validated, size-bounded
 * chunks (at most `MAX_RULEBOOK_BYTES`), so we coalesce them into one raw byte
 * array before writing. This keeps a single in-memory copy rather than the
 * JSON/base64/multipart envelope the upload transport explicitly rejects.
 */
async function collectBytes(
  source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    parts.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
