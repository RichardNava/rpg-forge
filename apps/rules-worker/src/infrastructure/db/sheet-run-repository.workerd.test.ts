import type { SheetGenerationRun } from "@repo/character-sheet-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1SheetRunRepository } from "./sheet-run-repository.js";

const MIGRATION_DDL =
  'CREATE TABLE `sheet_generation_runs` (`run_id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `analysis_id` text, `rules_analysis_run_id` text, `ingestion_id` text, `draft_id` text, `draft_version` integer, `mode` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `sheet_generation_runs_current_idx` ON `sheet_generation_runs` (`session_id`,`is_current`); CREATE INDEX `sheet_generation_runs_cleanup_idx` ON `sheet_generation_runs` (`status`,`expires_at`); CREATE UNIQUE INDEX `sheet_generation_runs_single_current_idx` ON `sheet_generation_runs` (`session_id`) WHERE "sheet_generation_runs"."is_current" = 1; CREATE TABLE `sheet_sessions` (`session_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `sheet_sessions_cleanup_idx` ON `sheet_sessions` (`status`,`expires_at`);';

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

const SESSION_ID = "sess-0001";
const SESSION_EXPIRY = new Date("2026-09-13T11:00:00.000Z");

function makeRun(
  overrides: Partial<SheetGenerationRun> = {},
): SheetGenerationRun {
  return {
    runId: crypto.randomUUID(),
    sessionId: SESSION_ID,
    analysisId: null,
    rulesAnalysisRunId: null,
    ingestionId: null,
    draftId: null,
    draftVersion: null,
    mode: "pc",
    status: "PENDING",
    failureCode: null,
    isCurrent: true,
    createdAt: new Date("2026-09-13T09:00:00.000Z"),
    updatedAt: new Date("2026-09-13T09:00:00.000Z"),
    expiresAt: SESSION_EXPIRY,
    ...overrides,
  };
}

describe("D1 sheet-run repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("creates a GUI-only run as current with null rulebook identities", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const run = makeRun();
    const result = await repository.createCurrent(run);
    expect(result.kind).toBe("created_current");
    const found = await repository.getById(run.runId);
    expect(found).toEqual(run);
    expect(found!.analysisId).toBeNull();
    expect(found!.rulesAnalysisRunId).toBeNull();
    expect(found!.ingestionId).toBeNull();
    expect(found!.draftId).toBeNull();
    expect(found!.draftVersion).toBeNull();
    expect(found!.expiresAt.getTime()).toBe(SESSION_EXPIRY.getTime());
    const current = await repository.getCurrentForSession(SESSION_ID);
    expect(current!.runId).toBe(run.runId);
    expect(current!.status).toBe("PENDING");
    expect(current!.isCurrent).toBe(true);
  });

  it("round-trips draft-backed provenance (draftId + draftVersion)", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const draftRun = makeRun({
      draftId: "draft-0001",
      draftVersion: 3,
    });
    const created = await repository.createCurrent(draftRun);
    expect(created.kind).toBe("created_current");
    const found = await repository.getById(draftRun.runId);
    expect(found!.draftId).toBe("draft-0001");
    expect(found!.draftVersion).toBe(3);
    expect(found!.isCurrent).toBe(true);
  });

  it("returns null for an unknown run id", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    expect(await repository.getById(crypto.randomUUID())).toBeNull();
  });

  it("repost supersedes: the previous run is invalidated and the new one is current", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const first = makeRun();
    const second = makeRun();
    await repository.createCurrent(first);
    await repository.createCurrent(second);

    const storedFirst = await repository.getById(first.runId);
    expect(storedFirst!.status).toBe("INVALIDATED");
    expect(storedFirst!.isCurrent).toBe(false);
    const current = await repository.getCurrentForSession(SESSION_ID);
    expect(current!.runId).toBe(second.runId);
    expect(current!.status).toBe("PENDING");
    expect(current!.isCurrent).toBe(true);
  });

  it("repost supersedes a FAILED current run too (status-agnostic repost)", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const failed = makeRun();
    await repository.createCurrent(failed);
    const mark = await repository.markFailed(
      failed.runId,
      "GENERATION_FAILED",
      new Date("2026-09-13T09:01:00.000Z"),
    );
    expect(mark.kind).toBe("transitioned");

    const next = makeRun();
    const result = await repository.createCurrent(next);
    expect(result.kind).toBe("created_current");
    const storedFailed = await repository.getById(failed.runId);
    expect(storedFailed!.status).toBe("INVALIDATED");
    expect(storedFailed!.isCurrent).toBe(false);
    const current = await repository.getCurrentForSession(SESSION_ID);
    expect(current!.runId).toBe(next.runId);
  });

  it("keeps exactly one current row per session through repeated reposts", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    for (let i = 0; i < 5; i++) {
      const result = await repository.createCurrent(makeRun());
      expect(result.kind).toBe("created_current");
    }
    const counted = await db
      .prepare(
        "SELECT COUNT(*) as count FROM sheet_generation_runs WHERE session_id = ?1 AND is_current = 1",
      )
      .bind(SESSION_ID)
      .first<{ count: number }>();
    expect(counted!.count).toBe(1);
    const current = await repository.getCurrentForSession(SESSION_ID);
    expect(current!.isCurrent).toBe(true);
  });

  it("enforces the partial unique index as a database backstop", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    await repository.createCurrent(makeRun());
    const second = makeRun();
    const overdue = db
      .prepare(
        "INSERT INTO sheet_generation_runs (run_id, session_id, analysis_id, rules_analysis_run_id, ingestion_id, mode, status, failure_code, is_current, created_at, updated_at, expires_at) VALUES (?1, ?2, NULL, NULL, NULL, 'pc', 'PENDING', NULL, 1, 0, 0, 0)",
      )
      .bind(second.runId, SESSION_ID);
    await expect(overdue.run()).rejects.toThrow();
  });

  it("isolates sessions: a repost for one session never touches another", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const a = makeRun();
    const b = makeRun({ sessionId: "sess-0002" });
    await repository.createCurrent(a);
    await repository.createCurrent(b);

    const storedA = await repository.getById(a.runId);
    expect(storedA!.status).toBe("PENDING");
    expect(storedA!.isCurrent).toBe(true);
    const currentB = await repository.getCurrentForSession("sess-0002");
    expect(currentB!.runId).toBe(b.runId);
    expect(currentB!.isCurrent).toBe(true);
  });

  it("PENDING -> READY clears the failure code and persists terminal state", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const run = makeRun({ failureCode: "GENERATION_FAILED" });
    await repository.createCurrent(run);
    const result = await repository.markReady(
      run.runId,
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(result.kind).toBe("transitioned");
    const found = await repository.getById(run.runId);
    expect(found!.status).toBe("READY");
    expect(found!.failureCode).toBeNull();
    expect(found!.isCurrent).toBe(true);
  });

  it("PENDING -> FAILED records the bounded failure code", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const run = makeRun({ mode: "npc" });
    await repository.createCurrent(run);
    const result = await repository.markFailed(
      run.runId,
      "INTERNAL_ERROR",
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(result.kind).toBe("transitioned");
    const found = await repository.getById(run.runId);
    expect(found!.status).toBe("FAILED");
    expect(found!.failureCode).toBe("INTERNAL_ERROR");
    expect(found!.mode).toBe("npc");
  });

  it("READY is terminal: FAILED cannot overwrite READY", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const run = makeRun();
    await repository.createCurrent(run);
    await repository.markReady(run.runId, new Date("2026-09-13T09:02:00.000Z"));
    const result = await repository.markFailed(
      run.runId,
      "GENERATION_FAILED",
      new Date("2026-09-13T09:03:00.000Z"),
    );
    expect(result.kind).toBe("wrong_state");
    const found = await repository.getById(run.runId);
    expect(found!.status).toBe("READY");
  });

  it("a stale invalidated run cannot transition and stays not current", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const first = makeRun();
    await repository.createCurrent(first);
    await repository.createCurrent(makeRun());
    const stale = await repository.markReady(
      first.runId,
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(stale.kind).toBe("not_current");
    const staleFailed = await repository.markFailed(
      first.runId,
      "INTERNAL_ERROR",
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(staleFailed.kind).toBe("not_current");
    const stored = await repository.getById(first.runId);
    expect(stored!.isCurrent).toBe(false);
    expect(stored!.status).toBe("INVALIDATED");
  });

  it("unknown transition targets return not_found", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const result = await repository.markReady(
      crypto.randomUUID(),
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(result.kind).toBe("not_found");
  });

  it("invalidateCurrent applies to PENDING and READY but refuses FAILED", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const pending = makeRun();
    await repository.createCurrent(pending);
    const invalidated = await repository.invalidateCurrent(
      pending.runId,
      new Date("2026-09-13T09:02:00.000Z"),
    );
    expect(invalidated.kind).toBe("transitioned");
    const storedPending = await repository.getById(pending.runId);
    expect(storedPending!.status).toBe("INVALIDATED");
    expect(storedPending!.isCurrent).toBe(false);

    const failed = makeRun();
    await repository.createCurrent(failed);
    await repository.markFailed(
      failed.runId,
      "INTERNAL_ERROR",
      new Date("2026-09-13T09:02:00.000Z"),
    );
    const refused = await repository.invalidateCurrent(
      failed.runId,
      new Date("2026-09-13T09:03:00.000Z"),
    );
    expect(refused.kind).toBe("wrong_state");
    const storedFailed = await repository.getById(failed.runId);
    expect(storedFailed!.status).toBe("FAILED");
    expect(storedFailed!.isCurrent).toBe(true);
  });

  it("expire transitions PENDING/READY to EXPIRED but never a terminal FAILED", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const pending = makeRun();
    await repository.createCurrent(pending);
    const expired = await repository.expire(
      pending.runId,
      new Date("2026-09-13T11:00:00.000Z"),
    );
    expect(expired.kind).toBe("transitioned");
    const stored = await repository.getById(pending.runId);
    expect(stored!.status).toBe("EXPIRED");
    expect(stored!.isCurrent).toBe(false);

    const ready = makeRun();
    await repository.createCurrent(ready);
    await repository.markReady(
      ready.runId,
      new Date("2026-09-13T09:02:00.000Z"),
    );
    const expiredReady = await repository.expire(
      ready.runId,
      new Date("2026-09-13T11:00:00.000Z"),
    );
    expect(expiredReady.kind).toBe("transitioned");

    const failed = makeRun();
    await repository.createCurrent(failed);
    await repository.markFailed(
      failed.runId,
      "GENERATION_FAILED",
      new Date("2026-09-13T09:02:00.000Z"),
    );
    const refused = await repository.expire(
      failed.runId,
      new Date("2026-09-13T11:00:00.000Z"),
    );
    expect(refused.kind).toBe("wrong_state");
    const storedFailed = await repository.getById(failed.runId);
    expect(storedFailed!.status).toBe("FAILED");
  });

  it("cleanup candidates expose sessionId + runId for expired runs with a limit", async () => {
    const repository = createD1SheetRunRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const now = new Date("2026-09-13T11:00:00.000Z");
    const cleanupSession = "sess-cleanup-1";
    const futureSession = "sess-cleanup-2";
    const earlyExpired = makeRun({
      sessionId: cleanupSession,
      expiresAt: new Date("2026-09-13T10:00:00.000Z"),
    });
    const boundaryExpired = makeRun({
      sessionId: cleanupSession,
      expiresAt: now,
    });
    const futureRun = makeRun({
      sessionId: futureSession,
      expiresAt: new Date("2026-09-13T12:00:00.000Z"),
    });
    for (const run of [earlyExpired, boundaryExpired, futureRun]) {
      await repository.createCurrent(run);
    }
    const candidates = await repository.findCleanupCandidates(now, 100);
    expect(candidates).toContainEqual({
      sessionId: cleanupSession,
      runId: earlyExpired.runId,
    });
    expect(candidates).toContainEqual({
      sessionId: cleanupSession,
      runId: boundaryExpired.runId,
    });
    expect(candidates).not.toContainEqual({
      sessionId: futureSession,
      runId: futureRun.runId,
    });
    expect(candidates).toContainEqual({
      sessionId: cleanupSession,
      runId: boundaryExpired.runId,
    });
    expect(candidates).not.toContainEqual({
      sessionId: futureSession,
      runId: futureRun.runId,
    });

    const limited = await repository.findCleanupCandidates(now, 1);
    expect(limited).toHaveLength(1);
  });
});
