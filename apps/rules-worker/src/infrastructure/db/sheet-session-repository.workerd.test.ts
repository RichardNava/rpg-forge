import { SHEET_CLEANUP_RETRY_GRACE_MS } from "@repo/character-sheet-session";
import type { SheetSession } from "@repo/character-sheet-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1SheetSessionRepository } from "./sheet-session-repository.js";

const MIGRATION_DDL =
  'CREATE TABLE `sheet_generation_runs` (`run_id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `analysis_id` text, `rules_analysis_run_id` text, `ingestion_id` text, `mode` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `sheet_generation_runs_current_idx` ON `sheet_generation_runs` (`session_id`,`is_current`); CREATE INDEX `sheet_generation_runs_cleanup_idx` ON `sheet_generation_runs` (`status`,`expires_at`); CREATE UNIQUE INDEX `sheet_generation_runs_single_current_idx` ON `sheet_generation_runs` (`session_id`) WHERE "sheet_generation_runs"."is_current" = 1; CREATE TABLE `sheet_sessions` (`session_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `sheet_sessions_cleanup_idx` ON `sheet_sessions` (`status`,`expires_at`);';

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

function makeSession(overrides: Partial<SheetSession> = {}): SheetSession {
  return {
    sessionId: crypto.randomUUID(),
    tokenHash: "a".repeat(64),
    status: "ACTIVE",
    createdAt: new Date("2026-09-13T09:00:00.000Z"),
    updatedAt: new Date("2026-09-13T09:00:00.000Z"),
    expiresAt: new Date("2026-09-13T11:00:00.000Z"),
    ...overrides,
  };
}

describe("D1 sheet-session repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("round-trips create and findById with 120-minute expiry timestamps", async () => {
    const repository = createD1SheetSessionRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const session = makeSession();
    await repository.create(session);
    const found = await repository.findById(session.sessionId);
    expect(found).toEqual(session);
    expect(found!.status).toBe("ACTIVE");
    expect(found!.tokenHash).toBe("a".repeat(64));
  });

  it("returns null for an unknown id", async () => {
    const repository = createD1SheetSessionRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  it("marks an active session DELETING and persists the new updatedAt", async () => {
    const before = new Date("2026-09-13T09:00:00.000Z");
    const repository = createD1SheetSessionRepository(db, {
      clock: { now: () => before },
    });
    const session = makeSession();
    await repository.create(session);
    const transition = await repository.markDeletingIfActive(session.sessionId);
    expect(transition).toBe("transitioned");
    const found = await repository.findById(session.sessionId);
    expect(found!.status).toBe("DELETING");
    expect(found!.updatedAt.getTime()).toBe(before.getTime());
  });

  it("is idempotent for a session already DELETING", async () => {
    const repository = createD1SheetSessionRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const session = makeSession({ status: "DELETING" });
    await repository.create(session);
    const transition = await repository.markDeletingIfActive(session.sessionId);
    expect(transition).toBe("already_deleting");
  });

  it("returns not_found for an unknown transition target", async () => {
    const repository = createD1SheetSessionRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    expect(await repository.markDeletingIfActive(crypto.randomUUID())).toBe(
      "not_found",
    );
  });

  it("finds expired ACTIVE sessions and stale DELETING sessions; expiry boundary is inclusive", async () => {
    const now = new Date("2026-09-13T11:00:00.000Z");
    const repository = createD1SheetSessionRepository(db, {
      clock: { now: () => now },
    });
    const expiredBoundary = makeSession({
      expiresAt: now,
      status: "ACTIVE",
    });
    const expiredPast = makeSession({
      expiresAt: new Date("2026-09-13T10:59:00.000Z"),
      status: "ACTIVE",
    });
    const staleDeleting = makeSession({
      status: "DELETING",
      updatedAt: new Date(now.getTime() - SHEET_CLEANUP_RETRY_GRACE_MS - 1),
    });
    const activeFresh = makeSession({
      expiresAt: new Date("2026-09-13T12:00:00.000Z"),
      status: "ACTIVE",
    });
    const freshDeleting = makeSession({
      status: "DELETING",
      updatedAt: now,
    });
    for (const s of [
      expiredBoundary,
      expiredPast,
      staleDeleting,
      activeFresh,
      freshDeleting,
    ]) {
      await repository.create(s);
    }
    const candidates = await repository.findCleanupCandidates(now, 10);
    const ids = candidates.map((c) => c.sessionId);
    expect(ids).toContain(expiredBoundary.sessionId);
    expect(ids).toContain(expiredPast.sessionId);
    expect(ids).toContain(staleDeleting.sessionId);
    expect(ids).not.toContain(activeFresh.sessionId);
    expect(ids).not.toContain(freshDeleting.sessionId);
  });

  it("respects the candidate limit", async () => {
    const now = new Date("2026-09-13T11:00:00.000Z");
    const repository = createD1SheetSessionRepository(db, {
      clock: { now: () => now },
    });
    for (let i = 0; i < 5; i++) {
      await repository.create(
        makeSession({ expiresAt: new Date("2026-09-13T10:00:00.000Z") }),
      );
    }
    const candidates = await repository.findCleanupCandidates(now, 2);
    expect(candidates).toHaveLength(2);
  });

  it("deletes a row", async () => {
    const repository = createD1SheetSessionRepository(db, {
      clock: fixedClock("2026-09-13T09:00:00.000Z"),
    });
    const session = makeSession();
    await repository.create(session);
    await repository.delete(session.sessionId);
    expect(await repository.findById(session.sessionId)).toBeNull();
  });
});
