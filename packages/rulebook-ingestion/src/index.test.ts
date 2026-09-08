import { describe, expect, it } from "vitest";
import {
  CHUNK_OVERLAP_CHARS,
  MAX_RULEBOOK_BYTES,
  RULEBOOK_ARTIFACT_VERSION,
  assessTextQuality,
  buildExtractionArtifact,
  chunkExtraction,
  finalizeRulebookReady,
  processRulebook,
  recordTerminalRulebookFailure,
  removeRulebook,
  reserveRulebook,
  toPublicRulebook,
  validatePdfUpload,
  type ExtractionArtifact,
} from "./index.js";
import {
  FakeClock,
  FakeIdGenerator,
  FakePdfExtractor,
  FakeWorkflow,
  InMemoryRulebookRepository,
  InMemorySessionRepository,
  InMemoryStorage,
  makeActiveSession,
} from "./test/fakes.js";

const ANALYSIS_A = "00000000-0000-4000-8000-000000000101";
const ANALYSIS_B = "00000000-0000-4000-8000-000000000102";
const ANALYSIS_C = "00000000-0000-4000-8000-000000000103";

function makeDeps() {
  const clock = new FakeClock("2026-09-08T00:00:00.000Z");
  const repository = new InMemoryRulebookRepository(clock);
  const storage = new InMemoryStorage();
  const extractor = new FakePdfExtractor();
  const sessions = new InMemorySessionRepository();
  const idGenerator = new FakeIdGenerator();
  return { clock, repository, storage, extractor, sessions, idGenerator };
}

function makeArtifact(text: string, pageCount = 1): ExtractionArtifact {
  return {
    version: RULEBOOK_ARTIFACT_VERSION,
    analysisId: ANALYSIS_A,
    ingestionId: "00000000-0000-4000-8000-000000000201",
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      text,
    })),
  };
}

async function reserveQueued(analysisId: string, deps = makeDeps()) {
  const result = await reserveRulebook(analysisId, {
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    repository: deps.repository,
  });
  if (result.kind !== "reserved") {
    throw new Error("expected reservation");
  }
  await deps.repository.markQueuedIfUploading(
    analysisId,
    result.rulebook.ingestionId,
    10,
  );
  return { deps, rulebook: result.rulebook };
}

describe("rulebook reservation and lifecycle", () => {
  it("reserves one current rulebook per analysis session", async () => {
    const deps = makeDeps();
    const first = await reserveRulebook(ANALYSIS_A, {
      clock: deps.clock,
      idGenerator: new FakeIdGenerator(),
      repository: deps.repository,
    });
    const second = await reserveRulebook(ANALYSIS_A, {
      clock: deps.clock,
      idGenerator: new FakeIdGenerator(),
      repository: deps.repository,
    });

    expect(first.kind).toBe("reserved");
    expect(second).toEqual({ kind: "already_attached" });
    expect((await deps.repository.findByAnalysisId(ANALYSIS_A))?.status).toBe(
      "UPLOADING",
    );
  });

  it("uses a distinct opaque ingestion id for each sequential attachment", async () => {
    const deps = makeDeps();
    const ids = new FakeIdGenerator();
    const first = await reserveRulebook(ANALYSIS_A, {
      clock: deps.clock,
      idGenerator: ids,
      repository: deps.repository,
    });
    if (first.kind !== "reserved") {
      throw new Error("expected reservation");
    }
    await removeRulebook(ANALYSIS_A, {
      repository: deps.repository,
      storage: deps.storage,
      workflow: new FakeWorkflow(),
    });
    const second = await reserveRulebook(ANALYSIS_A, {
      clock: deps.clock,
      idGenerator: ids,
      repository: deps.repository,
    });

    expect(second.kind).toBe("reserved");
    if (second.kind === "reserved") {
      expect(second.rulebook.ingestionId).not.toBe(first.rulebook.ingestionId);
    }
  });

  it("keeps failed metadata attached until explicit remove", async () => {
    const { deps, rulebook } = await reserveQueued(ANALYSIS_A);
    await recordTerminalRulebookFailure(
      {
        analysisId: ANALYSIS_A,
        ingestionId: rulebook.ingestionId,
        failureCode: "RULEBOOK_INVALID_PDF",
      },
      { repository: deps.repository, storage: deps.storage },
    );

    const row = await deps.repository.findByAnalysisId(ANALYSIS_A);
    expect(row?.status).toBe("FAILED");
    expect(row?.failureCode).toBe("RULEBOOK_INVALID_PDF");
    await expect(
      reserveRulebook(ANALYSIS_A, {
        clock: deps.clock,
        idGenerator: new FakeIdGenerator(),
        repository: deps.repository,
      }),
    ).resolves.toEqual({ kind: "already_attached" });
  });

  it("returns a safe public view without generation or storage details", async () => {
    const { rulebook } = await reserveQueued(ANALYSIS_A);
    const view = toPublicRulebook(rulebook);
    expect(view).not.toHaveProperty("ingestionId");
    expect(view).not.toHaveProperty("tokenHash");
    expect(Object.keys(view).sort()).toEqual([
      "chunkCount",
      "createdAt",
      "extractedChars",
      "failure",
      "pageCount",
      "sizeBytes",
      "status",
      "updatedAt",
    ]);
  });
});

describe("streaming upload validation", () => {
  it("accepts an exact configured byte limit without buffering the body", async () => {
    const upload = validatePdfUpload(
      chunks([new TextEncoder().encode("%PDF-1")]),
      6,
    );
    await collect(upload.bytes);
    expect(upload.getSizeBytes()).toBe(6);
  });

  it("rejects actual oversized streams even when a declaration could lie", async () => {
    const upload = validatePdfUpload(
      chunks([new TextEncoder().encode("%PDF-123")]),
      5,
    );
    await expect(collect(upload.bytes)).rejects.toMatchObject({
      code: "RULEBOOK_TOO_LARGE",
    });
  });

  it("requires a PDF signature in the first 1024 bytes", async () => {
    const invalid = validatePdfUpload(chunks([new Uint8Array([1, 2, 3])]), 10);
    await expect(collect(invalid.bytes)).rejects.toMatchObject({
      code: "RULEBOOK_INVALID_PDF",
    });

    const prefixed = validatePdfUpload(
      chunks([new Uint8Array([0, 0, 37, 80, 68, 70, 45, 49])]),
      10,
    );
    await expect(collect(prefixed.bytes)).resolves.toHaveLength(1);
  });

  it("uses the 50 MiB product default", () => {
    expect(MAX_RULEBOOK_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("extraction quality and artifacts", () => {
  it("normalizes pages while preserving contiguous 1-based provenance", () => {
    const result = buildExtractionArtifact({
      analysisId: ANALYSIS_A,
      ingestionId: "00000000-0000-4000-8000-000000000201",
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: "line one  \r\nline two\0" },
        { pageNumber: 2, text: "paragraph\n\nnext" },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.artifact.pages[0]?.text).toBe("line one\nline two");
      expect(result.artifact.pages[1]?.pageNumber).toBe(2);
    }
  });

  it("rejects non-contiguous page records rather than silently repairing them", () => {
    const result = buildExtractionArtifact({
      analysisId: ANALYSIS_A,
      ingestionId: "00000000-0000-4000-8000-000000000201",
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: "first" },
        { pageNumber: 3, text: "second" },
      ],
    });
    expect(result).toEqual({ kind: "too_large" });
  });

  it("requires enough text across enough pages before accepting textual extraction", () => {
    const scannedLike = makeArtifact("cover text", 300);
    expect(assessTextQuality(scannedLike).kind).toBe("requires_ocr");

    const textual = makeArtifact("text ".repeat(250), 2);
    expect(assessTextQuality(textual).kind).toBe("sufficient");
  });
});

describe("deterministic page-aware chunking", () => {
  it("uses stable generation/page/order identifiers and preserves page provenance", () => {
    const artifact = makeArtifact("word ".repeat(500));
    const first = chunkExtraction(artifact);
    const second = chunkExtraction(artifact);
    expect(first).toEqual(second);
    if (first.kind === "ok") {
      expect(first.chunks[0]?.chunkId).toBe(
        "00000000-0000-4000-8000-000000000201:p1:c1",
      );
      expect(
        first.chunks.every((chunk) => chunk.pageStart === chunk.pageEnd),
      ).toBe(true);
      expect(first.chunks.every((chunk) => chunk.text.length <= 1_500)).toBe(
        true,
      );
    }
  });

  it("uses a bounded overlap and hard-splits pathological long prose", () => {
    const artifact = makeArtifact("x".repeat(3_100));
    const result = chunkExtraction(artifact);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const first = result.chunks[0]?.text ?? "";
      const second = result.chunks[1]?.text ?? "";
      expect(second.startsWith(first.slice(-CHUNK_OVERLAP_CHARS))).toBe(true);
    }
  });

  it("fails instead of creating an unbounded number of chunks", () => {
    const artifact = makeArtifact("x".repeat(6_000));
    expect(chunkExtraction(artifact, { maxChunks: 2 })).toEqual({
      kind: "too_many_chunks",
    });
  });
});

describe("processing and generation guards", () => {
  it("accepts 499 and 500 pages but maps 501 to a terminal failure", async () => {
    const { deps, rulebook } = await reserveQueued(ANALYSIS_A);
    await deps.storage.putRaw({
      analysisId: ANALYSIS_A,
      ingestionId: rulebook.ingestionId,
      bytes: chunks([new TextEncoder().encode("%PDF-1")]),
    });

    deps.extractor.outcome = {
      kind: "extracted",
      pageCount: 499,
      pages: Array.from({ length: 499 }, (_, index) => ({
        pageNumber: index + 1,
        text: "x".repeat(100),
      })),
    };
    const accepted499 = await processRulebook(
      { analysisId: ANALYSIS_A, ingestionId: rulebook.ingestionId },
      {
        repository: deps.repository,
        storage: deps.storage,
        extractor: deps.extractor,
      },
    );
    expect(accepted499.kind).toBe("ready");

    const second = await reserveQueued(ANALYSIS_B, deps);
    await deps.storage.putRaw({
      analysisId: ANALYSIS_B,
      ingestionId: second.rulebook.ingestionId,
      bytes: chunks([new TextEncoder().encode("%PDF-1")]),
    });
    deps.extractor.outcome = {
      kind: "extracted",
      pageCount: 500,
      pages: Array.from({ length: 500 }, (_, index) => ({
        pageNumber: index + 1,
        text: "x".repeat(100),
      })),
    };
    const accepted500 = await processRulebook(
      { analysisId: ANALYSIS_B, ingestionId: second.rulebook.ingestionId },
      {
        repository: deps.repository,
        storage: deps.storage,
        extractor: deps.extractor,
      },
    );
    expect(accepted500.kind).toBe("ready");

    const other = await reserveQueued(ANALYSIS_C, deps);
    await deps.storage.putRaw({
      analysisId: ANALYSIS_C,
      ingestionId: other.rulebook.ingestionId,
      bytes: chunks([new TextEncoder().encode("%PDF-1")]),
    });
    deps.extractor.outcome = { kind: "too_many_pages", pageCount: 501 };
    await expect(
      processRulebook(
        { analysisId: ANALYSIS_C, ingestionId: other.rulebook.ingestionId },
        {
          repository: deps.repository,
          storage: deps.storage,
          extractor: deps.extractor,
        },
      ),
    ).resolves.toEqual({
      kind: "terminal_failure",
      failureCode: "RULEBOOK_TOO_MANY_PAGES",
    });
  });

  it("cannot finalize READY after its parent session expires", async () => {
    const { deps, rulebook } = await reserveQueued(ANALYSIS_A);
    await deps.sessions.create(makeActiveSession(ANALYSIS_A, deps.clock.now()));
    await deps.repository.ensureProcessing(ANALYSIS_A, rulebook.ingestionId);
    deps.clock.advance(12 * 60 * 60 * 1000);

    await expect(
      finalizeRulebookReady(
        {
          analysisId: ANALYSIS_A,
          ingestionId: rulebook.ingestionId,
          pageCount: 2,
          chunkCount: 2,
          extractedChars: 1_400,
        },
        {
          clock: deps.clock,
          sessionRepository: deps.sessions,
          repository: deps.repository,
        },
      ),
    ).resolves.toBe("skipped");
  });

  it("does not mutate a replacement generation from stale processing", async () => {
    const { deps, rulebook } = await reserveQueued(ANALYSIS_A);
    await deps.repository.markDeleting(ANALYSIS_A);
    await deps.repository.deleteIfGeneration(ANALYSIS_A, rulebook.ingestionId);
    const replacement = await reserveQueued(ANALYSIS_A, deps);

    await expect(
      processRulebook(
        { analysisId: ANALYSIS_A, ingestionId: rulebook.ingestionId },
        {
          repository: deps.repository,
          storage: deps.storage,
          extractor: deps.extractor,
        },
      ),
    ).resolves.toEqual({ kind: "skipped" });
    expect(
      (await deps.repository.findByAnalysisId(ANALYSIS_A))?.ingestionId,
    ).toBe(replacement.rulebook.ingestionId);
  });
});

describe("remove rulebook", () => {
  it("terminates, deletes the generation artifacts, and allows reupload", async () => {
    const { deps, rulebook } = await reserveQueued(ANALYSIS_A);
    await deps.storage.putRaw({
      analysisId: ANALYSIS_A,
      ingestionId: rulebook.ingestionId,
      bytes: chunks([new TextEncoder().encode("%PDF-1")]),
    });
    const workflow = new FakeWorkflow();

    await expect(
      removeRulebook(ANALYSIS_A, {
        repository: deps.repository,
        storage: deps.storage,
        workflow,
      }),
    ).resolves.toBe("deleted");
    expect(workflow.terminated).toEqual([rulebook.ingestionId]);
    expect(await deps.repository.findByAnalysisId(ANALYSIS_A)).toBeNull();
    await expect(
      reserveRulebook(ANALYSIS_A, {
        clock: deps.clock,
        idGenerator: new FakeIdGenerator(),
        repository: deps.repository,
      }),
    ).resolves.toMatchObject({ kind: "reserved" });
  });

  it("is idempotent and leaves a retryable DELETING row when cleanup fails", async () => {
    const { deps } = await reserveQueued(ANALYSIS_A);
    const workflow = new FakeWorkflow();
    workflow.failOnTerminate = true;
    await expect(
      removeRulebook(ANALYSIS_A, {
        repository: deps.repository,
        storage: deps.storage,
        workflow,
      }),
    ).rejects.toThrow("workflow terminate failed");
    expect((await deps.repository.findByAnalysisId(ANALYSIS_A))?.status).toBe(
      "DELETING",
    );

    workflow.failOnTerminate = false;
    await expect(
      removeRulebook(ANALYSIS_A, {
        repository: deps.repository,
        storage: deps.storage,
        workflow,
      }),
    ).resolves.toBe("deleted");
    await expect(
      removeRulebook(ANALYSIS_A, {
        repository: deps.repository,
        storage: deps.storage,
        workflow,
      }),
    ).resolves.toBe("not_found");
  });
});

async function* chunks(
  values: readonly Uint8Array[],
): AsyncGenerator<Uint8Array> {
  for (const value of values) {
    yield value;
  }
}

async function collect(
  source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const output: Uint8Array[] = [];
  for await (const value of source) {
    output.push(value);
  }
  return output;
}
