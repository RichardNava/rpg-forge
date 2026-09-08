import { z } from "zod";

export const MAX_RULEBOOK_BYTES = 50 * 1024 * 1024;
export const MAX_RULEBOOK_PAGES = 500;
export const MAX_PAGE_TEXT_CHARS = 20_000;
export const MAX_TOTAL_EXTRACTED_CHARS = 2_000_000;
export const MIN_TOTAL_TEXT_CHARS = 1_000;
export const MIN_AVERAGE_TEXT_CHARS_PER_PAGE = 50;
export const MIN_MEANINGFUL_PAGE_CHARS = 100;
export const MIN_MEANINGFUL_PAGE_RATIO = 0.05;
export const TARGET_CHUNK_TEXT_CHARS = 1_200;
export const MAX_CHUNK_TEXT_CHARS = 1_500;
export const CHUNK_OVERLAP_CHARS = 200;
export const MAX_RULEBOOK_CHUNKS = 2_500;
export const RULEBOOK_ARTIFACT_VERSION = 1;

export const RULEBOOK_STATUSES = [
  "UPLOADING",
  "QUEUED",
  "PROCESSING",
  "READY",
  "FAILED",
  "DELETING",
] as const;

export const RulebookStatusSchema = z.enum(RULEBOOK_STATUSES);

export type RulebookStatus = (typeof RULEBOOK_STATUSES)[number];

export const RULEBOOK_FAILURE_CODES = [
  "RULEBOOK_INVALID_PDF",
  "RULEBOOK_TOO_MANY_PAGES",
  "RULEBOOK_REQUIRES_OCR",
  "RULEBOOK_EXTRACTION_TOO_LARGE",
  "RULEBOOK_TOO_MANY_CHUNKS",
  "RULEBOOK_PROCESSING_FAILED",
] as const;

export const RulebookFailureCodeSchema = z.enum(RULEBOOK_FAILURE_CODES);

export type RulebookFailureCode = (typeof RULEBOOK_FAILURE_CODES)[number];

export interface RulebookIngestion {
  analysisId: string;
  ingestionId: string;
  status: RulebookStatus;
  sizeBytes: number;
  pageCount: number | null;
  chunkCount: number | null;
  extractedChars: number | null;
  failureCode: RulebookFailureCode | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicRulebook {
  status: RulebookStatus;
  sizeBytes: number;
  pageCount: number | null;
  chunkCount: number | null;
  extractedChars: number | null;
  failure: RulebookFailureCode | null;
  createdAt: string;
  updatedAt: string;
}

export const PublicRulebookSchema = z.strictObject({
  status: RulebookStatusSchema,
  sizeBytes: z.number().int().min(0),
  pageCount: z.number().int().min(1).max(MAX_RULEBOOK_PAGES).nullable(),
  chunkCount: z.number().int().min(0).nullable(),
  extractedChars: z.number().int().min(0).nullable(),
  failure: RulebookFailureCodeSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export function toPublicRulebook(rulebook: RulebookIngestion): PublicRulebook {
  return {
    status: rulebook.status,
    sizeBytes: rulebook.sizeBytes,
    pageCount: rulebook.pageCount,
    chunkCount: rulebook.chunkCount,
    extractedChars: rulebook.extractedChars,
    failure: rulebook.failureCode,
    createdAt: rulebook.createdAt.toISOString(),
    updatedAt: rulebook.updatedAt.toISOString(),
  };
}

export const ExtractedPageSchema = z.strictObject({
  pageNumber: z.number().int().min(1).max(MAX_RULEBOOK_PAGES),
  text: z.string().max(MAX_PAGE_TEXT_CHARS),
});

export type ExtractedPage = z.infer<typeof ExtractedPageSchema>;

export const ExtractionArtifactSchema = z
  .strictObject({
    version: z.literal(RULEBOOK_ARTIFACT_VERSION),
    analysisId: z.uuid(),
    ingestionId: z.uuid(),
    pageCount: z.number().int().min(1).max(MAX_RULEBOOK_PAGES),
    pages: z.array(ExtractedPageSchema).min(1).max(MAX_RULEBOOK_PAGES),
  })
  .superRefine((artifact, ctx) => {
    if (artifact.pages.length !== artifact.pageCount) {
      ctx.addIssue({
        code: "custom",
        message: "Page records must match pageCount.",
      });
    }

    let totalChars = 0;
    for (let index = 0; index < artifact.pages.length; index += 1) {
      const page = artifact.pages[index];
      if (page === undefined) {
        continue;
      }
      if (page.pageNumber !== index + 1) {
        ctx.addIssue({
          code: "custom",
          message: "Page records must be contiguous and 1-based.",
          path: ["pages", index, "pageNumber"],
        });
      }
      totalChars += page.text.length;
    }

    if (totalChars > MAX_TOTAL_EXTRACTED_CHARS) {
      ctx.addIssue({
        code: "custom",
        message: "Extracted text exceeds the temporary ingestion limit.",
      });
    }
  });

export type ExtractionArtifact = z.infer<typeof ExtractionArtifactSchema>;

export const RulebookChunkSchema = z.strictObject({
  version: z.literal(RULEBOOK_ARTIFACT_VERSION),
  chunkId: z.string().min(1).max(200),
  pageStart: z.number().int().min(1).max(MAX_RULEBOOK_PAGES),
  pageEnd: z.number().int().min(1).max(MAX_RULEBOOK_PAGES),
  text: z.string().min(1).max(MAX_CHUNK_TEXT_CHARS),
});

export type RulebookChunk = z.infer<typeof RulebookChunkSchema>;

export function serializeExtractionArtifact(
  artifact: ExtractionArtifact,
): string {
  return JSON.stringify(ExtractionArtifactSchema.parse(artifact));
}

export function serializeChunksJsonl(chunks: readonly RulebookChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }
  return `${chunks
    .map((chunk) => JSON.stringify(RulebookChunkSchema.parse(chunk)))
    .join("\n")}\n`;
}
