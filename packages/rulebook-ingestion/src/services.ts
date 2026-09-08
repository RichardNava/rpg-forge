import {
  isExpired,
  type Clock,
  type SessionRepositoryPort,
} from "@repo/rules-analysis-session";
import {
  MAX_RULEBOOK_PAGES,
  serializeChunksJsonl,
  type RulebookFailureCode,
  type RulebookIngestion,
} from "./model.js";
import type {
  IngestionIdGenerator,
  PdfPageExtractorPort,
  RulebookProcessingWorkflowPort,
  RulebookRepositoryPort,
  TemporaryRulebookStoragePort,
} from "./ports.js";
import {
  assessTextQuality,
  buildExtractionArtifact,
  chunkExtraction,
} from "./processing.js";

export interface ReserveRulebookDeps {
  clock: Clock;
  idGenerator: IngestionIdGenerator;
  repository: RulebookRepositoryPort;
}

export type ReserveRulebookResult =
  | { kind: "reserved"; rulebook: RulebookIngestion }
  | { kind: "already_attached" };

export async function reserveRulebook(
  analysisId: string,
  deps: ReserveRulebookDeps,
): Promise<ReserveRulebookResult> {
  const now = deps.clock.now();
  const rulebook: RulebookIngestion = {
    analysisId,
    ingestionId: deps.idGenerator.uuid(),
    status: "UPLOADING",
    sizeBytes: 0,
    pageCount: null,
    chunkCount: null,
    extractedChars: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
  const reservation = await deps.repository.reserve(rulebook);
  return reservation === "reserved"
    ? { kind: "reserved", rulebook }
    : { kind: "already_attached" };
}

export async function queueRulebook(
  input: { analysisId: string; ingestionId: string; sizeBytes: number },
  repository: RulebookRepositoryPort,
): Promise<boolean> {
  return repository.markQueuedIfUploading(
    input.analysisId,
    input.ingestionId,
    input.sizeBytes,
  );
}

export interface ProcessRulebookDeps {
  repository: RulebookRepositoryPort;
  storage: TemporaryRulebookStoragePort;
  extractor: PdfPageExtractorPort;
}

export type ProcessRulebookResult =
  | { kind: "skipped" }
  | {
      kind: "ready";
      pageCount: number;
      chunkCount: number;
      extractedChars: number;
    }
  | { kind: "terminal_failure"; failureCode: RulebookFailureCode };

export async function processRulebook(
  input: { analysisId: string; ingestionId: string },
  deps: ProcessRulebookDeps,
): Promise<ProcessRulebookResult> {
  const transition = await deps.repository.ensureProcessing(
    input.analysisId,
    input.ingestionId,
  );
  if (transition === "not_current") {
    return { kind: "skipped" };
  }

  const source = await deps.storage.openRaw(input);
  const extracted = await deps.extractor.extract({
    source,
    maxPages: MAX_RULEBOOK_PAGES,
  });
  if (extracted.kind === "invalid_pdf") {
    return { kind: "terminal_failure", failureCode: "RULEBOOK_INVALID_PDF" };
  }
  if (extracted.kind === "too_many_pages") {
    return {
      kind: "terminal_failure",
      failureCode: "RULEBOOK_TOO_MANY_PAGES",
    };
  }

  const artifact = buildExtractionArtifact({
    analysisId: input.analysisId,
    ingestionId: input.ingestionId,
    pageCount: extracted.pageCount,
    pages: extracted.pages,
  });
  if (artifact.kind === "too_large") {
    return {
      kind: "terminal_failure",
      failureCode: "RULEBOOK_EXTRACTION_TOO_LARGE",
    };
  }

  const quality = assessTextQuality(artifact.artifact);
  if (quality.kind === "requires_ocr") {
    return {
      kind: "terminal_failure",
      failureCode: "RULEBOOK_REQUIRES_OCR",
    };
  }

  const chunking = chunkExtraction(artifact.artifact);
  if (chunking.kind === "too_many_chunks") {
    return {
      kind: "terminal_failure",
      failureCode: "RULEBOOK_TOO_MANY_CHUNKS",
    };
  }

  await deps.storage.putExtraction({ ...input, artifact: artifact.artifact });
  await deps.storage.putChunks({
    ...input,
    jsonl: serializeChunksJsonl(chunking.chunks),
  });
  return {
    kind: "ready",
    pageCount: artifact.artifact.pageCount,
    chunkCount: chunking.chunks.length,
    extractedChars: artifact.extractedChars,
  };
}

export interface FinalizeRulebookDeps {
  clock: Clock;
  sessionRepository: SessionRepositoryPort;
  repository: RulebookRepositoryPort;
}

export async function finalizeRulebookReady(
  input: {
    analysisId: string;
    ingestionId: string;
    pageCount: number;
    chunkCount: number;
    extractedChars: number;
  },
  deps: FinalizeRulebookDeps,
): Promise<"ready" | "skipped"> {
  const session = await deps.sessionRepository.findById(input.analysisId);
  if (
    session === null ||
    session.status !== "ACTIVE" ||
    isExpired(session, deps.clock.now())
  ) {
    return "skipped";
  }
  const finalized = await deps.repository.markReadyIfProcessing(input);
  return finalized ? "ready" : "skipped";
}

export async function recordTerminalRulebookFailure(
  input: {
    analysisId: string;
    ingestionId: string;
    failureCode: RulebookFailureCode;
  },
  deps: Pick<ProcessRulebookDeps, "repository" | "storage">,
): Promise<boolean> {
  await deps.storage.deleteArtifacts(input);
  return deps.repository.markFailedIfCurrent(input);
}

export interface RemoveRulebookDeps {
  repository: RulebookRepositoryPort;
  storage: TemporaryRulebookStoragePort;
  workflow: RulebookProcessingWorkflowPort;
}

export type RemoveRulebookResult = "deleted" | "not_found";

/**
 * A failed cleanup deliberately throws after the row has reached DELETING.
 * Repeating this operation is therefore safe and retries the same generation.
 */
export async function removeRulebook(
  analysisId: string,
  deps: RemoveRulebookDeps,
): Promise<RemoveRulebookResult> {
  const transition = await deps.repository.markDeleting(analysisId);
  return removeTransitionedRulebook(transition, deps);
}

export async function removeRulebookGeneration(
  input: { analysisId: string; ingestionId: string },
  deps: RemoveRulebookDeps,
): Promise<RemoveRulebookResult> {
  const transition = await deps.repository.markDeletingGeneration(
    input.analysisId,
    input.ingestionId,
  );
  return removeTransitionedRulebook(transition, deps);
}

async function removeTransitionedRulebook(
  transition: Awaited<ReturnType<RulebookRepositoryPort["markDeleting"]>>,
  deps: RemoveRulebookDeps,
): Promise<RemoveRulebookResult> {
  if (transition.kind === "not_found") {
    return "not_found";
  }

  const { rulebook } = transition;
  await deps.workflow.terminate(rulebook.ingestionId);
  await deps.storage.deleteArtifacts({
    analysisId: rulebook.analysisId,
    ingestionId: rulebook.ingestionId,
  });
  await deps.repository.deleteIfGeneration(
    rulebook.analysisId,
    rulebook.ingestionId,
  );
  return "deleted";
}
