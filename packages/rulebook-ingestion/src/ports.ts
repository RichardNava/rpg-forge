import type {
  ExtractionArtifact,
  ExtractedPage,
  RulebookFailureCode,
  RulebookIngestion,
} from "./model.js";

export interface IngestionIdGenerator {
  uuid(): string;
}

export interface RulebookBinarySource {
  sizeBytes: number;
  readRange(offset: number, length: number): Promise<Uint8Array>;
}

export type PdfExtractionOutcome =
  | {
      kind: "extracted";
      pageCount: number;
      pages: readonly ExtractedPage[];
    }
  | { kind: "invalid_pdf" }
  | { kind: "too_many_pages"; pageCount: number };

export interface PdfPageExtractorPort {
  extract(input: {
    source: RulebookBinarySource;
    maxPages: number;
  }): Promise<PdfExtractionOutcome>;
}

export interface TemporaryRulebookStoragePort {
  putRaw(input: {
    analysisId: string;
    ingestionId: string;
    bytes: AsyncIterable<Uint8Array>;
  }): Promise<void>;
  openRaw(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<RulebookBinarySource>;
  putExtraction(input: {
    analysisId: string;
    ingestionId: string;
    artifact: ExtractionArtifact;
  }): Promise<void>;
  putChunks(input: {
    analysisId: string;
    ingestionId: string;
    jsonl: string;
  }): Promise<void>;
  deleteArtifacts(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<void>;
}

export interface RulebookWorkflowParams {
  analysisId: string;
  ingestionId: string;
}

export interface RulebookProcessingWorkflowPort {
  start(input: RulebookWorkflowParams): Promise<void>;
  terminate(ingestionId: string): Promise<void>;
}

export type RulebookReservationResult = "reserved" | "already_attached";

export type RulebookProcessingTransition =
  "transitioned" | "already_processing" | "not_current";

export type RulebookDeletionTransition =
  | { kind: "not_found" }
  | {
      kind: "transitioned" | "already_deleting";
      rulebook: RulebookIngestion;
    };

export interface RulebookRepositoryPort {
  reserve(rulebook: RulebookIngestion): Promise<RulebookReservationResult>;
  findByAnalysisId(analysisId: string): Promise<RulebookIngestion | null>;
  findByGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookIngestion | null>;
  markQueuedIfUploading(
    analysisId: string,
    ingestionId: string,
    sizeBytes: number,
  ): Promise<boolean>;
  ensureProcessing(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookProcessingTransition>;
  markReadyIfProcessing(input: {
    analysisId: string;
    ingestionId: string;
    pageCount: number;
    chunkCount: number;
    extractedChars: number;
  }): Promise<boolean>;
  markFailedIfCurrent(input: {
    analysisId: string;
    ingestionId: string;
    failureCode: RulebookFailureCode;
  }): Promise<boolean>;
  markDeleting(analysisId: string): Promise<RulebookDeletionTransition>;
  markDeletingGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookDeletionTransition>;
  deleteIfGeneration(analysisId: string, ingestionId: string): Promise<void>;
}
