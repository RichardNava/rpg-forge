import type {
  RulebookFailureCode,
  RulebookIngestion,
} from "@repo/rulebook-ingestion";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1RulebookRepository } from "./rulebook-repository.js";

const MIGRATION_DDL =
  "CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`);";

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

function makeRulebook(
  overrides: Partial<RulebookIngestion> = {},
): RulebookIngestion {
  return {
    analysisId: crypto.randomUUID(),
    ingestionId: crypto.randomUUID(),
    status: "UPLOADING",
    sizeBytes: 0,
    pageCount: null,
    chunkCount: null,
    extractedChars: null,
    failureCode: null,
    createdAt: new Date("2026-09-07T10:00:00.000Z"),
    updatedAt: new Date("2026-09-07T10:00:00.000Z"),
    ...overrides,
  };
}

describe("D1 rulebook repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("reserves a rulebook atomically and rejects a second for the same analysis", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const first = makeRulebook();
    const second = makeRulebook({ analysisId: first.analysisId });
    expect(await repository.reserve(first)).toBe("reserved");
    expect(await repository.reserve(second)).toBe("already_attached");
    const found = await repository.findByAnalysisId(first.analysisId);
    expect(found?.ingestionId).toBe(first.ingestionId);
    expect(found?.status).toBe("UPLOADING");
  });

  it("maps UPLOADING -> QUEUED -> PROCESSING -> READY by generation", async () => {
    const clock = fixedClock("2026-09-07T10:00:00.000Z");
    const repository = createD1RulebookRepository(db, { clock });
    const rulebook = makeRulebook();
    await repository.reserve(rulebook);

    await repository.markQueuedIfUploading(
      rulebook.analysisId,
      rulebook.ingestionId,
      12_345,
    );
    let current = await repository.findByGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(current?.status).toBe("QUEUED");
    expect(current?.sizeBytes).toBe(12_345);

    expect(
      await repository.ensureProcessing(
        rulebook.analysisId,
        rulebook.ingestionId,
      ),
    ).toBe("transitioned");
    expect(
      await repository.ensureProcessing(
        rulebook.analysisId,
        rulebook.ingestionId,
      ),
    ).toBe("already_processing");
    current = await repository.findByGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(current?.status).toBe("PROCESSING");

    const ready = await repository.markReadyIfProcessing({
      analysisId: rulebook.analysisId,
      ingestionId: rulebook.ingestionId,
      pageCount: 12,
      chunkCount: 4,
      extractedChars: 6_000,
    });
    expect(ready).toBe(true);
    current = await repository.findByGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(current?.status).toBe("READY");
    expect(current?.pageCount).toBe(12);
    expect(current?.chunkCount).toBe(4);
    expect(current?.extractedChars).toBe(6_000);
    expect(current?.failureCode).toBeNull();
  });

  it("does not transition a stale generation's data through markReady", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const rulebook = makeRulebook({ status: "QUEUED" });
    await repository.reserve(rulebook);
    expect(
      await repository.markReadyIfProcessing({
        analysisId: rulebook.analysisId,
        ingestionId: rulebook.ingestionId,
        pageCount: 1,
        chunkCount: 1,
        extractedChars: 1,
      }),
    ).toBe(false);
  });

  it("guards ensureProcessing against a non-current generation", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const rulebook = makeRulebook();
    await repository.reserve(rulebook);
    expect(
      await repository.ensureProcessing(
        rulebook.analysisId,
        "other-0000-4000-8000-000000000001",
      ),
    ).toBe("not_current");
  });

  it("records terminal failure only for current statuses", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const rulebook = makeRulebook({ status: "QUEUED" });
    await repository.reserve(rulebook);
    const failureCode: RulebookFailureCode = "RULEBOOK_REQUIRES_OCR";
    expect(
      await repository.markFailedIfCurrent({
        analysisId: rulebook.analysisId,
        ingestionId: rulebook.ingestionId,
        failureCode,
      }),
    ).toBe(true);
    const found = await repository.findByAnalysisId(rulebook.analysisId);
    expect(found?.status).toBe("FAILED");
    expect(found?.failureCode).toBe(failureCode);
  });

  it("marks deleting and does not allow READY after DELETING", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const rulebook = makeRulebook({ status: "PROCESSING" });
    await repository.reserve(rulebook);

    const transition = await repository.markDeletingGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(transition.kind).toBe("transitioned");
    const replay = await repository.markDeletingGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(replay.kind).toBe("already_deleting");

    expect(
      await repository.markReadyIfProcessing({
        analysisId: rulebook.analysisId,
        ingestionId: rulebook.ingestionId,
        pageCount: 1,
        chunkCount: 1,
        extractedChars: 1,
      }),
    ).toBe(false);
    expect(
      await repository.markFailedIfCurrent({
        analysisId: rulebook.analysisId,
        ingestionId: rulebook.ingestionId,
        failureCode: "RULEBOOK_PROCESSING_FAILED",
      }),
    ).toBe(false);
  });

  it("returns not_found for markDeleting on an unknown generation", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    expect(
      await repository.markDeletingGeneration(
        crypto.randomUUID(),
        crypto.randomUUID(),
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("deletes only the matched generation", async () => {
    const repository = createD1RulebookRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const rulebook = makeRulebook();
    await repository.reserve(rulebook);
    await repository.deleteIfGeneration(
      rulebook.analysisId,
      "other-0000-4000-8000-000000000001",
    );
    expect(
      await repository.findByAnalysisId(rulebook.analysisId),
    ).not.toBeNull();
    await repository.deleteIfGeneration(
      rulebook.analysisId,
      rulebook.ingestionId,
    );
    expect(await repository.findByAnalysisId(rulebook.analysisId)).toBeNull();
  });
});
