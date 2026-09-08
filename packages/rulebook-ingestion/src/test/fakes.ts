import type {
  AnalysisSession,
  RepositoryTransition,
  SessionRepositoryPort,
} from "@repo/rules-analysis-session";
import type { Clock } from "@repo/rules-analysis-session";
import type {
  ExtractionArtifact,
  ExtractedPage,
  RulebookFailureCode,
  RulebookIngestion,
} from "../model.js";
import type {
  PdfExtractionOutcome,
  PdfPageExtractorPort,
  RulebookBinarySource,
  RulebookDeletionTransition,
  RulebookProcessingTransition,
  RulebookProcessingWorkflowPort,
  RulebookRepositoryPort,
  TemporaryRulebookStoragePort,
} from "../ports.js";

export class FakeClock implements Clock {
  private current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export class FakeIdGenerator {
  private sequence = 0;

  uuid(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }
}

export class InMemoryRulebookRepository implements RulebookRepositoryPort {
  readonly rows = new Map<string, RulebookIngestion>();
  readonly deleteLog: string[] = [];
  readonly transitionLog: string[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async reserve(
    rulebook: RulebookIngestion,
  ): Promise<"reserved" | "already_attached"> {
    if (this.rows.has(rulebook.analysisId)) {
      return "already_attached";
    }
    this.rows.set(rulebook.analysisId, cloneRulebook(rulebook));
    return "reserved";
  }

  async findByAnalysisId(
    analysisId: string,
  ): Promise<RulebookIngestion | null> {
    const row = this.rows.get(analysisId);
    return row === undefined ? null : cloneRulebook(row);
  }

  async findByGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookIngestion | null> {
    const row = this.rows.get(analysisId);
    return row === undefined || row.ingestionId !== ingestionId
      ? null
      : cloneRulebook(row);
  }

  async markQueuedIfUploading(
    analysisId: string,
    ingestionId: string,
    sizeBytes: number,
  ): Promise<boolean> {
    const row = this.rows.get(analysisId);
    if (
      row === undefined ||
      row.ingestionId !== ingestionId ||
      row.status !== "UPLOADING"
    ) {
      return false;
    }
    row.status = "QUEUED";
    row.sizeBytes = sizeBytes;
    row.updatedAt = this.clock.now();
    return true;
  }

  async ensureProcessing(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookProcessingTransition> {
    const row = this.rows.get(analysisId);
    if (row === undefined || row.ingestionId !== ingestionId) {
      return "not_current";
    }
    if (row.status === "PROCESSING") {
      return "already_processing";
    }
    if (row.status !== "QUEUED") {
      return "not_current";
    }
    row.status = "PROCESSING";
    row.updatedAt = this.clock.now();
    return "transitioned";
  }

  async markReadyIfProcessing(input: {
    analysisId: string;
    ingestionId: string;
    pageCount: number;
    chunkCount: number;
    extractedChars: number;
  }): Promise<boolean> {
    const row = this.rows.get(input.analysisId);
    if (
      row === undefined ||
      row.ingestionId !== input.ingestionId ||
      row.status !== "PROCESSING"
    ) {
      return false;
    }
    row.status = "READY";
    row.pageCount = input.pageCount;
    row.chunkCount = input.chunkCount;
    row.extractedChars = input.extractedChars;
    row.failureCode = null;
    row.updatedAt = this.clock.now();
    return true;
  }

  async markFailedIfCurrent(input: {
    analysisId: string;
    ingestionId: string;
    failureCode: RulebookFailureCode;
  }): Promise<boolean> {
    const row = this.rows.get(input.analysisId);
    if (
      row === undefined ||
      row.ingestionId !== input.ingestionId ||
      !["UPLOADING", "QUEUED", "PROCESSING"].includes(row.status)
    ) {
      return false;
    }
    row.status = "FAILED";
    row.failureCode = input.failureCode;
    row.updatedAt = this.clock.now();
    return true;
  }

  async markDeleting(analysisId: string): Promise<RulebookDeletionTransition> {
    const row = this.rows.get(analysisId);
    if (row === undefined) {
      return { kind: "not_found" };
    }
    return this.markDeletingGeneration(analysisId, row.ingestionId);
  }

  async markDeletingGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookDeletionTransition> {
    const row = this.rows.get(analysisId);
    if (row === undefined || row.ingestionId !== ingestionId) {
      return { kind: "not_found" };
    }
    if (row.status === "DELETING") {
      return { kind: "already_deleting", rulebook: cloneRulebook(row) };
    }
    row.status = "DELETING";
    row.updatedAt = this.clock.now();
    this.transitionLog.push(`${analysisId}:${row.ingestionId}`);
    return { kind: "transitioned", rulebook: cloneRulebook(row) };
  }

  async deleteIfGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<void> {
    const row = this.rows.get(analysisId);
    if (row === undefined || row.ingestionId !== ingestionId) {
      return;
    }
    this.deleteLog.push(`${analysisId}:${ingestionId}`);
    this.rows.delete(analysisId);
  }
}

export class InMemoryStorage implements TemporaryRulebookStoragePort {
  readonly raw = new Map<string, Uint8Array>();
  readonly extraction = new Map<string, ExtractionArtifact>();
  readonly chunks = new Map<string, string>();
  readonly deleteLog: string[] = [];
  failOn = new Set<"putRaw" | "putExtraction" | "putChunks" | "delete">();

  async putRaw(input: {
    analysisId: string;
    ingestionId: string;
    bytes: AsyncIterable<Uint8Array>;
  }): Promise<void> {
    this.throwIfRequested("putRaw");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of input.bytes) {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      chunks.push(copy);
      length += copy.byteLength;
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.raw.set(key(input.analysisId, input.ingestionId), output);
  }

  async openRaw(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<RulebookBinarySource> {
    const bytes = this.raw.get(key(input.analysisId, input.ingestionId));
    if (bytes === undefined) {
      throw new Error("raw missing");
    }
    return {
      sizeBytes: bytes.byteLength,
      async readRange(offset: number, length: number): Promise<Uint8Array> {
        return bytes.slice(offset, offset + length);
      },
    };
  }

  async putExtraction(input: {
    analysisId: string;
    ingestionId: string;
    artifact: ExtractionArtifact;
  }): Promise<void> {
    this.throwIfRequested("putExtraction");
    this.extraction.set(
      key(input.analysisId, input.ingestionId),
      structuredClone(input.artifact),
    );
  }

  async putChunks(input: {
    analysisId: string;
    ingestionId: string;
    jsonl: string;
  }): Promise<void> {
    this.throwIfRequested("putChunks");
    this.chunks.set(key(input.analysisId, input.ingestionId), input.jsonl);
  }

  async deleteArtifacts(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<void> {
    this.throwIfRequested("delete");
    const artifactKey = key(input.analysisId, input.ingestionId);
    this.deleteLog.push(artifactKey);
    this.raw.delete(artifactKey);
    this.extraction.delete(artifactKey);
    this.chunks.delete(artifactKey);
  }

  private throwIfRequested(
    operation: "putRaw" | "putExtraction" | "putChunks" | "delete",
  ): void {
    if (this.failOn.has(operation)) {
      throw new Error(`storage ${operation} failed`);
    }
  }
}

export class FakePdfExtractor implements PdfPageExtractorPort {
  outcome: PdfExtractionOutcome = {
    kind: "extracted",
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: "A".repeat(700) },
      { pageNumber: 2, text: "B".repeat(700) },
    ],
  };

  async extract(): Promise<PdfExtractionOutcome> {
    return structuredClone(this.outcome);
  }
}

export class FakeWorkflow implements RulebookProcessingWorkflowPort {
  readonly started: string[] = [];
  readonly terminated: string[] = [];
  failOnStart = false;
  failOnTerminate = false;

  async start(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<void> {
    if (this.failOnStart) {
      throw new Error("workflow start failed");
    }
    this.started.push(`${input.analysisId}:${input.ingestionId}`);
  }

  async terminate(ingestionId: string): Promise<void> {
    if (this.failOnTerminate) {
      throw new Error("workflow terminate failed");
    }
    this.terminated.push(ingestionId);
  }
}

export class InMemorySessionRepository implements SessionRepositoryPort {
  readonly sessions = new Map<string, AnalysisSession>();

  async create(session: AnalysisSession): Promise<void> {
    this.sessions.set(session.analysisId, cloneSession(session));
  }

  async findById(analysisId: string): Promise<AnalysisSession | null> {
    const session = this.sessions.get(analysisId);
    return session === undefined ? null : cloneSession(session);
  }

  async markDeletingIfActive(
    analysisId: string,
  ): Promise<RepositoryTransition> {
    const session = this.sessions.get(analysisId);
    if (session === undefined) {
      return "not_found";
    }
    if (session.status === "ACTIVE") {
      session.status = "DELETING";
      return "transitioned";
    }
    return "already_deleting";
  }

  async findCleanupCandidates(): Promise<AnalysisSession[]> {
    return [];
  }

  async delete(analysisId: string): Promise<void> {
    this.sessions.delete(analysisId);
  }
}

export function makeActiveSession(
  analysisId: string,
  now: Date,
): AnalysisSession {
  return {
    analysisId,
    tokenHash: "a".repeat(64),
    status: "ACTIVE",
    createdAt: new Date(now.getTime()),
    updatedAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
  };
}

function cloneRulebook(rulebook: RulebookIngestion): RulebookIngestion {
  return {
    ...rulebook,
    createdAt: new Date(rulebook.createdAt.getTime()),
    updatedAt: new Date(rulebook.updatedAt.getTime()),
  };
}

function cloneSession(session: AnalysisSession): AnalysisSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt.getTime()),
    updatedAt: new Date(session.updatedAt.getTime()),
    expiresAt: new Date(session.expiresAt.getTime()),
  };
}

function key(analysisId: string, ingestionId: string): string {
  return `${analysisId}/${ingestionId}`;
}
