import type {
  RuleBuildFailureCode,
  RulesAnalysisRun,
} from "@repo/rules-analysis-run";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1RulesAnalysisRunRepository } from "./run-repository.js";

const MIGRATION_DDL =
  'CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`); CREATE TABLE `rules_analysis_runs` (`run_id` text PRIMARY KEY NOT NULL, `analysis_id` text NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`); CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`); CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`); CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;';

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

function makeRun(overrides: Partial<RulesAnalysisRun> = {}): RulesAnalysisRun {
  return {
    runId: crypto.randomUUID(),
    analysisId: crypto.randomUUID(),
    ingestionId: crypto.randomUUID(),
    status: "QUEUED",
    failureCode: null,
    isCurrent: true,
    createdAt: new Date("2026-09-07T10:00:00.000Z"),
    updatedAt: new Date("2026-09-07T10:00:00.000Z"),
    ...overrides,
  };
}

async function insertRow(
  db: D1Database,
  run: Omit<RulesAnalysisRun, "createdAt" | "updatedAt"> & {
    createdAt: Date;
    updatedAt: Date;
  },
) {
  await db
    .prepare(
      "INSERT INTO rules_analysis_runs (run_id, analysis_id, ingestion_id, status, failure_code, is_current, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      run.runId,
      run.analysisId,
      run.ingestionId,
      run.status,
      run.failureCode,
      run.isCurrent ? 1 : 0,
      run.createdAt.getTime(),
      run.updatedAt.getTime(),
    )
    .run();
}

describe("D1 rules-analysis run repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("creates a current QUEUED run and rounds it trip", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun();
    expect(await repository.createCurrent(run)).toBe("created_current");
    const current = await repository.findCurrent(run.analysisId);
    expect(current?.runId).toBe(run.runId);
    expect(current?.status).toBe("QUEUED");
    expect(current?.isCurrent).toBe(true);
    const found = await repository.findRun(run.analysisId, run.runId);
    expect(found?.ingestionId).toBe(run.ingestionId);
  });

  it("rejects a second current run while a non-FAILED current exists", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const first = makeRun();
    const second = makeRun({ analysisId: first.analysisId });
    expect(await repository.createCurrent(first)).toBe("created_current");
    expect(await repository.createCurrent(second)).toBe("superseded");
    const current = await repository.findCurrent(first.analysisId);
    expect(current?.runId).toBe(first.runId);
  });

  it("supersedes a FAILED current run and keeps the failed row", async () => {
    const clock = { now: () => new Date("2026-09-07T10:00:00.000Z") };
    const repository = createD1RulesAnalysisRunRepository(db, { clock });
    const failed = makeRun();
    await repository.createCurrent(failed);
    await repository.markFailedIfCurrent(
      failed.runId,
      "RULES_CONTEXT_MODEL_UNAVAILABLE",
      clock.now(),
    );

    const replacement = makeRun({ analysisId: failed.analysisId });
    expect(await repository.createCurrent(replacement)).toBe("created_current");
    const current = await repository.findCurrent(failed.analysisId);
    expect(current?.runId).toBe(replacement.runId);
    expect(current?.status).toBe("QUEUED");
    const old = await repository.findRun(failed.analysisId, failed.runId);
    expect(old?.status).toBe("FAILED");
    expect(old?.isCurrent).toBe(false);
  });

  it("claims a QUEUED or RUNNING run, rejects stale guards", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun();
    await repository.createCurrent(run);

    expect(
      await repository.claimRunningIfCurrent(
        run.runId,
        run.analysisId,
        run.ingestionId,
      ),
    ).toBe("claimed");
    expect(
      await repository.claimRunningIfCurrent(
        run.runId,
        run.analysisId,
        run.ingestionId,
      ),
    ).toBe("claimed");
    expect(
      await repository.claimRunningIfCurrent(
        run.runId,
        run.analysisId,
        "other-0000-4000-8000-000000000002",
      ),
    ).toBe("not_current");
  });

  it("does not claim a superseded, non-current run", async () => {
    const clock = { now: () => new Date("2026-09-07T10:00:00.000Z") };
    const repository = createD1RulesAnalysisRunRepository(db, { clock });
    const superseded = makeRun();
    await repository.createCurrent(superseded);
    await repository.markInvalidatedIfCurrent(superseded.runId, clock.now());

    expect(
      await repository.claimRunningIfCurrent(
        superseded.runId,
        superseded.analysisId,
        superseded.ingestionId,
      ),
    ).toBe("not_current");
  });

  it("finalizes only the current run and records the new updatedAt", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun();
    await repository.createCurrent(run);
    const updatedAt = new Date("2026-09-07T10:05:00.000Z");
    const finalized = await repository.finalizeIfCurrent(run.runId, {
      status: "CONFLICTS",
      updatedAt,
    });
    expect(finalized).toBe(true);
    const current = await repository.findCurrent(run.analysisId);
    expect(current?.status).toBe("CONFLICTS");
    expect(current?.updatedAt).toEqual(updatedAt);

    await repository.markInvalidatedIfCurrent(run.runId, updatedAt);
    expect(
      await repository.finalizeIfCurrent(run.runId, {
        status: "READY",
        updatedAt,
      }),
    ).toBe(false);
  });

  it("marks the current run FAILED with a resumable status", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun();
    await repository.createCurrent(run);
    const failureCode: RuleBuildFailureCode = "RULES_CONTEXT_INDEX_UNAVAILABLE";
    const updatedAt = new Date("2026-09-07T10:05:00.000Z");
    expect(
      await repository.markFailedIfCurrent(run.runId, failureCode, updatedAt),
    ).toBe(true);
    const current = await repository.findCurrent(run.analysisId);
    expect(current?.status).toBe("FAILED");
    expect(current?.failureCode).toBe(failureCode);
    expect(current?.isCurrent).toBe(true);
    expect(current?.updatedAt).toEqual(updatedAt);

    expect(
      await repository.markFailedIfCurrent(
        "other-0000-4000-8000-000000000003",
        failureCode,
        updatedAt,
      ),
    ).toBe(false);
  });

  it("confirms only a current CONFLICTS run for the exact generation", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun({ status: "CONFLICTS" });
    await repository.createCurrent(run);
    const updatedAt = new Date("2026-09-07T10:05:00.000Z");

    expect(
      await repository.confirmIfCurrent(run.runId, {
        analysisId: run.analysisId,
        ingestionId: run.ingestionId,
        updatedAt,
      }),
    ).toBe(true);
    expect((await repository.findCurrent(run.analysisId))?.status).toBe(
      "CONFIRMED",
    );
  });

  it("rejects confirms for READY runs, wrong generations, and inactive runs", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun({ status: "READY" });
    await repository.createCurrent(run);
    const updatedAt = new Date("2026-09-07T10:05:00.000Z");

    expect(
      await repository.confirmIfCurrent(run.runId, {
        analysisId: run.analysisId,
        ingestionId: run.ingestionId,
        updatedAt,
      }),
    ).toBe(false);
    expect(
      await repository.confirmIfCurrent(run.runId, {
        analysisId: run.analysisId,
        ingestionId: "other-0000-4000-8000-000000000004",
        updatedAt,
      }),
    ).toBe(false);

    await repository.markInvalidatedIfCurrent(run.runId, updatedAt);
    expect(
      await repository.confirmIfCurrent(run.runId, {
        analysisId: run.analysisId,
        ingestionId: run.ingestionId,
        updatedAt,
      }),
    ).toBe(false);
  });

  it("invalidates the current run and makes it non-current", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun({ status: "READY" });
    await repository.createCurrent(run);
    const updatedAt = new Date("2026-09-07T10:05:00.000Z");
    expect(
      await repository.markInvalidatedIfCurrent(run.runId, updatedAt),
    ).toBe(true);
    const current = await repository.findCurrent(run.analysisId);
    expect(current).toBeNull();
    const found = await repository.findRun(run.analysisId, run.runId);
    expect(found?.status).toBe("INVALIDATED");
    expect(found?.isCurrent).toBe(false);
    expect(found?.updatedAt).toEqual(updatedAt);
  });

  it("invalidates every generation run and returns the affected rows", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const current = makeRun({ status: "RUNNING" });
    await repository.createCurrent(current);
    await insertRow(db, {
      ...makeRun({
        analysisId: current.analysisId,
        ingestionId: current.ingestionId,
        status: "CONFIRMED",
        isCurrent: false,
        runId: crypto.randomUUID(),
      }),
      createdAt: new Date("2026-09-07T09:00:00.000Z"),
      updatedAt: new Date("2026-09-07T09:00:00.000Z"),
    });

    const affected = await repository.invalidateRunsForGeneration(
      current.analysisId,
      current.ingestionId,
    );
    expect(affected).toHaveLength(2);
    for (const run of affected) {
      expect(run.status).toBe("INVALIDATED");
      expect(run.isCurrent).toBe(false);
    }
    const all = await repository.listForAnalysis(current.analysisId);
    expect(all).toHaveLength(2);
    expect(all.every((run) => run.status === "INVALIDATED")).toBe(true);
  });

  it("treats an empty generation as a no-op", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const affected = await repository.invalidateRunsForGeneration(
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
    expect(affected).toEqual([]);
  });

  it("leaves FAILED rows out of generation invalidation", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const failed = makeRun({
      status: "FAILED",
      failureCode: "RULES_CONTEXT_MODEL_UNAVAILABLE",
    });
    await repository.createCurrent(failed);
    const queued = makeRun({
      analysisId: failed.analysisId,
      ingestionId: failed.ingestionId,
      isCurrent: false,
    });
    await insertRow(db, queued);

    const affected = await repository.invalidateRunsForGeneration(
      failed.analysisId,
      failed.ingestionId,
    );
    expect(affected).toHaveLength(1);
    expect(affected[0]?.runId).toBe(queued.runId);
    const failedRow = await repository.findRun(failed.analysisId, failed.runId);
    expect(failedRow?.status).toBe("FAILED");
  });

  it("lists every run for an analysis across statuses", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const analysisId = crypto.randomUUID();
    const failed = makeRun({
      analysisId,
      status: "FAILED",
      failureCode: "RULES_CONTEXT_STORAGE_UNAVAILABLE",
    });
    await repository.createCurrent(failed);
    const next = makeRun({
      analysisId,
      ingestionId: failed.ingestionId,
      status: "READY",
    });
    expect(await repository.createCurrent(next)).toBe("created_current");

    const list = await repository.listForAnalysis(analysisId);
    expect(list).toHaveLength(2);
    expect(list.some((run) => run.status === "FAILED")).toBe(true);
    expect(list.some((run) => run.status === "READY")).toBe(true);
  });

  it("deletes all rows for an analysis", async () => {
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const run = makeRun();
    await repository.createCurrent(run);
    await repository.deleteAllForAnalysis(run.analysisId);
    expect(await repository.listForAnalysis(run.analysisId)).toEqual([]);
    expect(await repository.findCurrent(run.analysisId)).toBeNull();
  });
});
